"""
Hourly metrics aggregation service.

PostgreSQL: single bulk-upsert SQL using native percentile/date_trunc functions.
SQLite:     Python-side computation — fetches raw rows, computes stats, upserts one
            row at a time.  Slower but correct on both engines.
"""
import json
import logging
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import IS_SQLITE

logger = logging.getLogger(__name__)


# ── Percentile helper (SQLite path) ──────────────────────────────────────────

def _percentile(sorted_vals: list[float], p: float) -> float | None:
    """Linear interpolation percentile — matches PostgreSQL PERCENTILE_CONT."""
    if not sorted_vals:
        return None
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    idx = p * (n - 1)
    lo = int(idx)
    hi = min(lo + 1, n - 1)
    frac = idx - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


# ── Public API ────────────────────────────────────────────────────────────────

def run_hourly_aggregation(db: Session) -> None:
    """
    Aggregate the previous full hour of events into metrics_hourly.
    Safe to call multiple times (upsert logic on both engines).
    Monthly usage is handled separately by run_monthly_aggregation().
    """
    now = datetime.now(UTC)
    try:
        if IS_SQLITE:
            hour_start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)
            hour_end   = hour_start + timedelta(hours=1)
            _aggregate_hour_sqlite(db, hour_start, hour_end)
        else:
            _aggregate_metrics_hourly_postgres(
                db,
                "date_trunc('hour', now() - interval '1 hour')",
                "date_trunc('hour', now())",
            )
        db.commit()
        logger.info("[aggregation] Hourly aggregation complete at %s", now.isoformat())
    except Exception as exc:
        db.rollback()
        logger.error("[aggregation] Hourly aggregation failed: %s", exc, exc_info=True)


def run_monthly_aggregation(db: Session) -> None:
    """
    Upsert current calendar-month totals into monthly_usage.
    Runs once daily — no need to run every hour.
    """
    try:
        if IS_SQLITE:
            _aggregate_monthly_usage_sqlite(db)
        else:
            _aggregate_monthly_usage_postgres(db)
        db.commit()
        logger.info("[aggregation] Monthly usage updated")
    except Exception as exc:
        db.rollback()
        logger.error("[aggregation] Monthly aggregation failed: %s", exc, exc_info=True)


def backfill_missing_hours(db: Session, lookback_hours: int = 48) -> None:
    """
    On startup, fill any hours in the last N hours that have events but no
    metrics_hourly row.  Ensures dashboards show correct data after downtime.
    """
    try:
        now = datetime.now(UTC)
        filled = 0
        for h in range(lookback_hours, 0, -1):
            hour_start = (now - timedelta(hours=h)).replace(minute=0, second=0, microsecond=0)
            hour_end   = hour_start + timedelta(hours=1)

            if hour_start >= now.replace(minute=0, second=0, microsecond=0):
                continue

            needs_fill = db.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM events
                    WHERE timestamp >= :h_start AND timestamp < :h_end
                ) AND NOT EXISTS (
                    SELECT 1 FROM metrics_hourly WHERE hour = :h_start
                )
            """), {"h_start": hour_start, "h_end": hour_end}).scalar()

            if needs_fill:
                if IS_SQLITE:
                    _aggregate_hour_sqlite(db, hour_start, hour_end)
                else:
                    h_start_lit = f"'{hour_start.isoformat()}'::timestamptz"
                    h_end_lit   = f"'{hour_end.isoformat()}'::timestamptz"
                    _aggregate_metrics_hourly_postgres(db, h_start_lit, h_end_lit)
                db.commit()
                filled += 1

        if filled:
            logger.info("[aggregation] Backfilled %d missing hour(s) on startup", filled)

        run_monthly_aggregation(db)
    except Exception as exc:
        db.rollback()
        logger.warning("[aggregation] Backfill failed (non-fatal): %s", exc)


# ── SQLite implementation ─────────────────────────────────────────────────────

def _aggregate_hour_sqlite(db: Session, hour_start: datetime, hour_end: datetime) -> None:
    rows = db.execute(text("""
        SELECT org_id, agent_id, duration_ms, cost_usd, status, model,
               input_tokens, output_tokens
        FROM events
        WHERE timestamp >= :h_start
          AND timestamp <  :h_end
          AND (
            run_metadata IS NULL
            OR json_extract(run_metadata, '$.event_name') IS NULL
            OR json_extract(run_metadata, '$.event_name') != 'session_metrics'
          )
    """), {"h_start": hour_start, "h_end": hour_end}).fetchall()

    if not rows:
        return

    # Group by (org_id, agent_id)
    groups: dict[tuple, dict] = defaultdict(lambda: {
        "durations": [], "costs": [], "statuses": [],
        "models": defaultdict(float),
        "input_tokens": 0, "output_tokens": 0,
    })
    for org_id, agent_id, duration_ms, cost_usd, status, model, inp, out in rows:
        key = (str(org_id), str(agent_id))
        g = groups[key]
        if duration_ms is not None:
            g["durations"].append(float(duration_ms))
        g["costs"].append(float(cost_usd or 0.0))
        g["statuses"].append(status)
        if model:
            g["models"][model] += float(cost_usd or 0.0)
        g["input_tokens"]  += int(inp or 0)
        g["output_tokens"] += int(out or 0)

    for (org_id, agent_id), g in groups.items():
        sorted_d   = sorted(g["durations"])
        run_count  = len(g["statuses"])
        success_c  = sum(1 for s in g["statuses"] if s == "success")
        failure_c  = run_count - success_c
        total_cost = sum(g["costs"])
        avg_d      = sum(g["durations"]) / len(g["durations"]) if g["durations"] else None

        db.execute(text("""
            INSERT INTO metrics_hourly (
                id, org_id, agent_id, hour,
                run_count, success_count, failure_count,
                avg_duration_ms, p50_duration_ms, p95_duration_ms, p99_duration_ms,
                total_cost_usd, total_input_tokens, total_output_tokens,
                cost_by_model, error_rate, loop_count, created_at
            ) VALUES (
                :id, :org_id, :agent_id, :hour,
                :run_count, :success_count, :failure_count,
                :avg_d, :p50, :p95, :p99,
                :total_cost, :inp_tok, :out_tok,
                :cost_by_model, :error_rate, 0, CURRENT_TIMESTAMP
            )
            ON CONFLICT(org_id, agent_id, hour) DO UPDATE SET
                run_count           = excluded.run_count,
                success_count       = excluded.success_count,
                failure_count       = excluded.failure_count,
                avg_duration_ms     = excluded.avg_duration_ms,
                p50_duration_ms     = excluded.p50_duration_ms,
                p95_duration_ms     = excluded.p95_duration_ms,
                p99_duration_ms     = excluded.p99_duration_ms,
                total_cost_usd      = excluded.total_cost_usd,
                total_input_tokens  = excluded.total_input_tokens,
                total_output_tokens = excluded.total_output_tokens,
                cost_by_model       = excluded.cost_by_model,
                error_rate          = excluded.error_rate
        """), {
            "id":           str(uuid.uuid4()),
            "org_id":       org_id,
            "agent_id":     agent_id,
            "hour":         hour_start.isoformat(),
            "run_count":    run_count,
            "success_count": success_c,
            "failure_count": failure_c,
            "avg_d":        avg_d,
            "p50":          _percentile(sorted_d, 0.50),
            "p95":          _percentile(sorted_d, 0.95),
            "p99":          _percentile(sorted_d, 0.99),
            "total_cost":   total_cost,
            "inp_tok":      g["input_tokens"],
            "out_tok":      g["output_tokens"],
            "cost_by_model": json.dumps(dict(g["models"])) if g["models"] else "{}",
            "error_rate":   failure_c / run_count if run_count else 0.0,
        })


def _aggregate_monthly_usage_sqlite(db: Session) -> None:
    rows = db.execute(text("""
        SELECT
            org_id,
            strftime('%Y-%m', timestamp) AS year_month,
            COUNT(*)        AS event_count,
            SUM(cost_usd)   AS total_cost_usd
        FROM events
        WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
          AND (
            run_metadata IS NULL
            OR json_extract(run_metadata, '$.event_name') IS NULL
            OR json_extract(run_metadata, '$.event_name') != 'session_metrics'
          )
        GROUP BY org_id, strftime('%Y-%m', timestamp)
    """)).fetchall()

    for org_id, year_month, event_count, total_cost in rows:
        db.execute(text("""
            INSERT INTO monthly_usage (id, org_id, year_month, event_count, total_cost_usd, updated_at)
            VALUES (:id, :org_id, :year_month, :event_count, :total_cost, CURRENT_TIMESTAMP)
            ON CONFLICT(org_id, year_month) DO UPDATE SET
                event_count    = excluded.event_count,
                total_cost_usd = excluded.total_cost_usd,
                updated_at     = excluded.updated_at
        """), {
            "id":          str(uuid.uuid4()),
            "org_id":      str(org_id),
            "year_month":  year_month,
            "event_count": int(event_count),
            "total_cost":  float(total_cost or 0.0),
        })


# ── PostgreSQL implementation ─────────────────────────────────────────────────

def _aggregate_metrics_hourly_postgres(
    db: Session, hour_start_sql: str, hour_end_sql: str
) -> None:
    sql = text(f"""
        INSERT INTO metrics_hourly (
            id, org_id, agent_id, hour,
            run_count, success_count, failure_count,
            avg_duration_ms, p50_duration_ms, p95_duration_ms, p99_duration_ms,
            total_cost_usd, total_input_tokens, total_output_tokens,
            cost_by_model, error_rate, loop_count, created_at
        )
        SELECT
            gen_random_uuid(),
            org_id,
            agent_id,
            {hour_start_sql}                                                        AS hour,
            COUNT(*)                                                                AS run_count,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)                   AS success_count,
            SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END)                   AS failure_count,
            AVG(duration_ms)                                                        AS avg_duration_ms,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms)              AS p50_duration_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)              AS p95_duration_ms,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms)              AS p99_duration_ms,
            SUM(cost_usd)                                                           AS total_cost_usd,
            COALESCE(SUM(input_tokens::bigint),  0)                                AS total_input_tokens,
            COALESCE(SUM(output_tokens::bigint), 0)                                AS total_output_tokens,
            COALESCE(
                jsonb_object_agg(model, model_cost) FILTER (WHERE model IS NOT NULL),
                '{{}}'::jsonb
            )                                                                       AS cost_by_model,
            AVG(CASE WHEN status = 'failed' THEN 1.0 ELSE 0.0 END)                AS error_rate,
            0                                                                       AS loop_count,
            now()                                                                   AS created_at
        FROM (
            SELECT
                org_id, agent_id, duration_ms, cost_usd, status, model,
                input_tokens, output_tokens,
                SUM(cost_usd) OVER (PARTITION BY org_id, agent_id, model) AS model_cost
            FROM events
            WHERE timestamp >= {hour_start_sql}
              AND timestamp <  {hour_end_sql}
              AND (run_metadata IS NULL
                   OR run_metadata->>'event_name' IS NULL
                   OR run_metadata->>'event_name' != 'session_metrics')
        ) sub
        GROUP BY org_id, agent_id
        ON CONFLICT (org_id, agent_id, hour) DO UPDATE SET
            run_count           = EXCLUDED.run_count,
            success_count       = EXCLUDED.success_count,
            failure_count       = EXCLUDED.failure_count,
            avg_duration_ms     = EXCLUDED.avg_duration_ms,
            p50_duration_ms     = EXCLUDED.p50_duration_ms,
            p95_duration_ms     = EXCLUDED.p95_duration_ms,
            p99_duration_ms     = EXCLUDED.p99_duration_ms,
            total_cost_usd      = EXCLUDED.total_cost_usd,
            total_input_tokens  = EXCLUDED.total_input_tokens,
            total_output_tokens = EXCLUDED.total_output_tokens,
            cost_by_model       = EXCLUDED.cost_by_model,
            error_rate          = EXCLUDED.error_rate
    """)
    try:
        db.execute(sql)
    except Exception as exc:
        if "does not exist" in str(exc).lower():
            logger.warning("[aggregation] metrics_hourly not yet created, skipping: %s", exc)
            db.rollback()
        else:
            raise


def _aggregate_monthly_usage_postgres(db: Session) -> None:
    sql = text("""
        INSERT INTO monthly_usage (id, org_id, year_month, event_count, total_cost_usd, updated_at)
        SELECT
            gen_random_uuid(),
            org_id,
            to_char(date_trunc('month', now()), 'YYYY-MM') AS year_month,
            COUNT(*)        AS event_count,
            SUM(cost_usd)   AS total_cost_usd,
            now()
        FROM events
        WHERE timestamp >= date_trunc('month', now())
          AND (run_metadata IS NULL
               OR run_metadata->>'event_name' IS NULL
               OR run_metadata->>'event_name' != 'session_metrics')
        GROUP BY org_id
        ON CONFLICT (org_id, year_month) DO UPDATE SET
            event_count    = EXCLUDED.event_count,
            total_cost_usd = EXCLUDED.total_cost_usd,
            updated_at     = now()
    """)
    try:
        db.execute(sql)
    except Exception as exc:
        if "does not exist" in str(exc).lower():
            logger.warning("[aggregation] monthly_usage not yet created, skipping: %s", exc)
            db.rollback()
        else:
            raise
