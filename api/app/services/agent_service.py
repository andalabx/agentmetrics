from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func, or_, text
from sqlalchemy.orm import Session

from app.database import IS_SQLITE
from app.db_compat import (
    epoch_diff_ms,
    json_extract_text,
    json_sql_extract,
    json_sql_not_eq,
    trunc_day,
)
from app.models.event import Event
from app.schemas.agent import (
    AgentDetail,
    AgentSummary,
    CostByDay,
    CostByModel,
    ErrorSummary,
    LatencyPercentiles,
    RecentRun,
)

_EXCLUDED_AGENTS = {"openclaw-gateway"}

# Exclude session_metrics events from run-level queries — they are session-boundary
# aggregates emitted by the plugin, not individual agent runs.
_NOT_SESSION_METRICS = or_(
    Event.run_metadata.is_(None),
    json_extract_text(Event.run_metadata, "event_name").is_(None),
    json_extract_text(Event.run_metadata, "event_name") != "session_metrics",
)

def _use_sqlite(db: Session) -> bool:
    """Detect the actual dialect of the current session at runtime."""
    if IS_SQLITE:
        return True
    try:
        return db.connection().dialect.name == "sqlite"
    except Exception:
        return False


def _sm_sql(is_sqlite: bool) -> str:
    return json_sql_not_eq("run_metadata", "event_name", "session_metrics", is_sqlite=is_sqlite)


def _retention_since(org_id: str, db: Session) -> datetime:
    return datetime.min.replace(tzinfo=UTC)


def get_agents_summary(org_id: str, db: Session, limit: int = 200, offset: int = 0) -> list[AgentSummary]:
    since = _retention_since(org_id, db)
    rows = (
        db.query(
            Event.agent_id,
            func.count(Event.id).label("total_calls"),
            func.sum(case((Event.status == "success", 1), else_=0)).label("successful"),
            func.sum(case((Event.status == "failed", 1), else_=0)).label("failed"),
            func.sum(Event.cost_usd).label("total_cost"),
            func.avg(Event.cost_usd).label("avg_cost"),
            func.max(Event.timestamp).label("last_seen"),
        )
        .filter(
            Event.org_id == org_id,
            ~Event.agent_id.in_(_EXCLUDED_AGENTS),
            Event.timestamp >= since,
            _NOT_SESSION_METRICS,
        )
        .group_by(Event.agent_id)
        .order_by(func.sum(Event.cost_usd).desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    results = []
    for row in rows:
        total = row.total_calls or 0
        successful = row.successful or 0
        results.append(AgentSummary(
            agent_id=row.agent_id,
            total_calls=total,
            successful=successful,
            failed=row.failed or 0,
            total_cost=round(row.total_cost or 0.0, 6),
            avg_cost=round(row.avg_cost or 0.0, 6),
            success_rate=round((successful / total * 100) if total > 0 else 0.0, 1),
            last_seen=row.last_seen,
        ))
    return results


def _event_to_run(e: Event) -> RecentRun:
    meta = e.run_metadata or {}

    def _int(col_val, meta_key: str):
        if col_val is not None:
            return int(col_val)
        v = meta.get(meta_key)
        return int(v) if v is not None else None

    return RecentRun(
        trace_id=e.trace_id,
        status=e.status,
        cost_usd=round(e.cost_usd or 0.0, 6),
        duration_ms=e.duration_ms,
        error_message=e.error_message,
        timestamp=e.timestamp,
        model=e.model,
        input_tokens=int(e.input_tokens) if e.input_tokens is not None else None,
        output_tokens=int(e.output_tokens) if e.output_tokens is not None else None,
        step_count=e.step_count,
        tool_calls=e.tool_calls,
        loop_count=_int(e.loop_count, "loop_count"),
        cache_read_tokens=_int(e.cache_read_tokens, "cache_read_tokens"),
        cache_write_tokens=_int(e.cache_write_tokens, "cache_write_tokens"),
        llm_calls=_int(e.llm_calls, "llm_calls"),
        environment=e.environment,
        version=e.version,
        steps=meta.get("steps") or None,
    )


def get_agent_runs(
    org_id: str, agent_id: str, db: Session, limit: int = 50, offset: int = 0
) -> tuple[list[RecentRun], int]:
    since = _retention_since(org_id, db)
    total = db.query(func.count(Event.id)).filter(
        Event.org_id == org_id,
        Event.agent_id == agent_id,
        Event.timestamp >= since,
        _NOT_SESSION_METRICS,
    ).scalar() or 0

    events = (
        db.query(Event)
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.timestamp >= since,
            _NOT_SESSION_METRICS,
        )
        .order_by(Event.timestamp.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return [_event_to_run(e) for e in events], total


def _percentiles(db: Session, org_id: str, agent_id: str, since: datetime) -> tuple:
    """Compute p50/p95/p99 latency percentiles, cross-dialect."""
    is_sqlite = _use_sqlite(db)
    sm = _sm_sql(is_sqlite)
    if is_sqlite:
        rows = db.execute(
            text(
                "SELECT duration_ms FROM events "
                "WHERE org_id = :org_id AND agent_id = :agent_id "
                "AND duration_ms IS NOT NULL AND timestamp >= :since "
                f"AND {sm} "
                "ORDER BY duration_ms"
            ),
            {"org_id": str(org_id), "agent_id": agent_id, "since": since},
        ).fetchall()
        vals = sorted(float(r[0]) for r in rows if r[0] is not None)
        if not vals:
            return None, None, None

        def _pct(lst: list[float], p: float) -> float:
            idx = (len(lst) - 1) * p
            lo, hi = int(idx), min(int(idx) + 1, len(lst) - 1)
            return round(lst[lo] + (lst[hi] - lst[lo]) * (idx - lo), 2)

        return _pct(vals, 0.50), _pct(vals, 0.95), _pct(vals, 0.99)

    row = db.execute(
        text(
            "SELECT "
            "  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms), "
            "  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), "
            "  percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) "
            "FROM events WHERE org_id = :org_id AND agent_id = :agent_id "
            "AND duration_ms IS NOT NULL AND timestamp >= :since "
            f"AND {sm}"
        ),
        {"org_id": str(org_id), "agent_id": agent_id, "since": since},
    ).fetchone()

    def _r(v):
        return round(float(v), 2) if v is not None else None

    return (_r(row[0]), _r(row[1]), _r(row[2])) if row else (None, None, None)


def _meta_aggregates(db: Session, org_id: str, agent_id: str, since: datetime):
    """Aggregate promoted + JSONB-fallback columns, cross-dialect."""
    is_sqlite = _use_sqlite(db)
    sm = _sm_sql(is_sqlite)

    def jx(col, key):
        return json_sql_extract(col, key, is_sqlite=is_sqlite)

    if is_sqlite:
        sql = text(f"""
            SELECT
                COALESCE(SUM(COALESCE(llm_calls,         CAST({jx('run_metadata','llm_calls')} AS INTEGER))),         0) AS llm_calls,
                COALESCE(SUM(COALESCE(subagents_spawned, CAST({jx('run_metadata','subagents_spawned')} AS INTEGER))),  0) AS subagents_spawned,
                COALESCE(SUM(COALESCE(compactions,       CAST({jx('run_metadata','compactions')} AS INTEGER))),        0) AS compactions,
                COALESCE(SUM(COALESCE(resets,            CAST({jx('run_metadata','resets')} AS INTEGER))),             0) AS resets,
                COALESCE(SUM(input_tokens),                                                                             0) AS input_tokens,
                COALESCE(SUM(output_tokens),                                                                            0) AS output_tokens,
                COALESCE(SUM(COALESCE(cache_read_tokens,  CAST({jx('run_metadata','cache_read_tokens')} AS INTEGER))), 0) AS cache_read_tokens,
                COALESCE(SUM(COALESCE(cache_write_tokens, CAST({jx('run_metadata','cache_write_tokens')} AS INTEGER))),0) AS cache_write_tokens,
                COALESCE(SUM(tool_calls),                                                                               0) AS tool_calls,
                COALESCE(SUM(COALESCE(tool_errors, CAST({jx('run_metadata','tool_errors')} AS INTEGER))),              0) AS tool_errors
            FROM events
            WHERE org_id = :org_id AND agent_id = :agent_id
              AND timestamp >= :since
              AND {sm}
        """)
    else:
        sql = text(f"""
            SELECT
                COALESCE(SUM(COALESCE(llm_calls,         ({jx('run_metadata','llm_calls')})::int)),         0) AS llm_calls,
                COALESCE(SUM(COALESCE(subagents_spawned, ({jx('run_metadata','subagents_spawned')})::int)),  0) AS subagents_spawned,
                COALESCE(SUM(COALESCE(compactions,       ({jx('run_metadata','compactions')})::int)),        0) AS compactions,
                COALESCE(SUM(COALESCE(resets,            ({jx('run_metadata','resets')})::int)),             0) AS resets,
                COALESCE(SUM(input_tokens::int),                                                              0) AS input_tokens,
                COALESCE(SUM(output_tokens::int),                                                             0) AS output_tokens,
                COALESCE(SUM(COALESCE(cache_read_tokens,  ({jx('run_metadata','cache_read_tokens')})::int)), 0) AS cache_read_tokens,
                COALESCE(SUM(COALESCE(cache_write_tokens, ({jx('run_metadata','cache_write_tokens')})::int)),0) AS cache_write_tokens,
                COALESCE(SUM(tool_calls),                                                                     0) AS tool_calls,
                COALESCE(SUM(COALESCE(tool_errors, ({jx('run_metadata','tool_errors')})::int)),              0) AS tool_errors
            FROM events
            WHERE org_id = :org_id AND agent_id = :agent_id
              AND timestamp >= :since
              AND {sm}
        """)
    return db.execute(sql, {"org_id": str(org_id), "agent_id": agent_id, "since": since}).fetchone()


def _mttr(db: Session, org_id: str, agent_id: str, since: datetime) -> float | None:
    """Mean time to recovery — cross-dialect."""
    is_sqlite = _use_sqlite(db)
    sm = _sm_sql(is_sqlite)
    diff_expr = epoch_diff_ms("timestamp", "prev_ts", is_sqlite=is_sqlite)
    sql = text(f"""
        WITH ordered AS (
            SELECT status, timestamp,
                   LAG(status)    OVER (ORDER BY timestamp) AS prev_status,
                   LAG(timestamp) OVER (ORDER BY timestamp) AS prev_ts
            FROM events
            WHERE org_id = :org_id AND agent_id = :agent_id
              AND timestamp >= :since
              AND {sm}
        )
        SELECT AVG({diff_expr})
        FROM ordered
        WHERE status = 'success' AND prev_status = 'failed'
    """)
    result = db.execute(sql, {"org_id": str(org_id), "agent_id": agent_id, "since": since}).scalar()
    return round(float(result), 2) if result is not None else None


def _top_tools(db: Session, org_id: str, agent_id: str, since: datetime) -> list[str]:
    """Aggregate tool names from JSON arrays, cross-dialect."""
    is_sqlite = _use_sqlite(db)
    if is_sqlite:
        # SQLite has no array-unnest; fetch JSON blobs and aggregate in Python.
        rows = db.execute(
            text(
                "SELECT run_metadata FROM events "
                "WHERE org_id = :org_id AND agent_id = :agent_id "
                f"AND {json_sql_extract('run_metadata','tool_names', is_sqlite=True)} IS NOT NULL "
                "AND timestamp >= :since"
            ),
            {"org_id": str(org_id), "agent_id": agent_id, "since": since},
        ).fetchall()
        counts: dict[str, int] = {}
        for (raw,) in rows:
            if not raw:
                continue
            try:
                meta = json.loads(raw) if isinstance(raw, str) else raw
                for name in meta.get("tool_names") or []:
                    counts[name] = counts.get(name, 0) + 1
            except (json.JSONDecodeError, TypeError, AttributeError):
                pass
        return sorted(counts, key=counts.__getitem__, reverse=True)[:10]

    rows = db.execute(
        text("""
            SELECT tool_name, COUNT(*) AS cnt
            FROM events,
                 jsonb_array_elements_text(run_metadata->'tool_names') AS tool_name
            WHERE org_id = :org_id AND agent_id = :agent_id
              AND run_metadata ? 'tool_names'
              AND timestamp >= :since
            GROUP BY tool_name
            ORDER BY cnt DESC
            LIMIT 10
        """),
        {"org_id": str(org_id), "agent_id": agent_id, "since": since},
    ).fetchall()
    return [r[0] for r in rows]


def get_agent_detail(org_id: str, agent_id: str, db: Session) -> AgentDetail | None:
    since = _retention_since(org_id, db)
    is_sqlite = _use_sqlite(db)

    row = (
        db.query(
            func.count(Event.id).label("total_calls"),
            func.sum(case((Event.status == "success", 1), else_=0)).label("successful"),
            func.sum(case((Event.status == "failed", 1), else_=0)).label("failed"),
            func.sum(Event.cost_usd).label("total_cost"),
            func.avg(Event.cost_usd).label("avg_cost"),
            func.avg(Event.duration_ms).label("avg_duration"),
            func.max(Event.timestamp).label("last_seen"),
        )
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.timestamp >= since,
            _NOT_SESSION_METRICS,
        )
        .first()
    )

    if not row or not row.total_calls:
        return None

    total = row.total_calls or 0
    successful = row.successful or 0

    p50, p95, p99 = _percentiles(db, org_id, agent_id, since)
    latency = LatencyPercentiles(
        p50=p50, p95=p95, p99=p99,
        avg=round(float(row.avg_duration), 2) if row.avg_duration else None,
    )

    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)
    cost_since = max(since, thirty_days_ago)
    daily_rows = (
        db.query(
            trunc_day(Event.timestamp, is_sqlite=is_sqlite).label("day"),
            func.sum(Event.cost_usd).label("cost"),
            func.count(Event.id).label("calls"),
        )
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.timestamp >= cost_since,
            _NOT_SESSION_METRICS,
        )
        .group_by(trunc_day(Event.timestamp, is_sqlite=is_sqlite))
        .order_by(text("day"))
        .all()
    )
    cost_by_day = [
        CostByDay(date=str(r.day)[:10], cost=round(r.cost or 0.0, 6), calls=r.calls)
        for r in daily_rows
    ]

    model_rows = (
        db.query(
            Event.model,
            func.sum(Event.cost_usd).label("cost"),
            func.count(Event.id).label("calls"),
            func.sum(Event.input_tokens).label("input_tokens"),
            func.sum(Event.output_tokens).label("output_tokens"),
        )
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.model.isnot(None),
            Event.timestamp >= since,
            _NOT_SESSION_METRICS,
        )
        .group_by(Event.model)
        .order_by(func.sum(Event.cost_usd).desc())
        .all()
    )
    cost_by_model = [
        CostByModel(
            model=r.model,
            cost_usd=round(r.cost or 0.0, 6),
            calls=r.calls,
            input_tokens=int(r.input_tokens or 0),
            output_tokens=int(r.output_tokens or 0),
        )
        for r in model_rows
    ]

    mttr_ms = _mttr(db, org_id, agent_id, since)

    recent_events = (
        db.query(Event)
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.timestamp >= since,
            _NOT_SESSION_METRICS,
        )
        .order_by(Event.timestamp.desc())
        .limit(20)
        .all()
    )
    recent_runs = [_event_to_run(e) for e in recent_events]

    error_rows = (
        db.query(Event.error_message, func.count(Event.id).label("count"))
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.status == "failed",
            Event.error_message.isnot(None),
            Event.timestamp >= since,
            _NOT_SESSION_METRICS,
        )
        .group_by(Event.error_message)
        .order_by(func.count(Event.id).desc())
        .limit(5)
        .all()
    )
    top_errors = [ErrorSummary(error_message=r.error_message, count=r.count) for r in error_rows]

    meta_row = _meta_aggregates(db, org_id, agent_id, since)
    top_tools = _top_tools(db, org_id, agent_id, since)

    return AgentDetail(
        agent_id=agent_id,
        total_calls=total,
        successful=successful,
        failed=row.failed or 0,
        total_cost=round(row.total_cost or 0.0, 6),
        avg_cost=round(row.avg_cost or 0.0, 6),
        success_rate=round((successful / total * 100) if total > 0 else 0.0, 1),
        last_seen=row.last_seen,
        latency=latency,
        avg_duration_ms=round(float(row.avg_duration), 2) if row.avg_duration else None,
        cost_by_day=cost_by_day,
        cost_by_model=cost_by_model,
        mttr_ms=mttr_ms,
        recent_runs=recent_runs,
        top_errors=top_errors,
        total_input_tokens=int(meta_row.input_tokens or 0) if meta_row else 0,
        total_output_tokens=int(meta_row.output_tokens or 0) if meta_row else 0,
        total_cache_read_tokens=int(meta_row.cache_read_tokens or 0) if meta_row else 0,
        total_cache_write_tokens=int(meta_row.cache_write_tokens or 0) if meta_row else 0,
        total_llm_calls=int(meta_row.llm_calls or 0) if meta_row else 0,
        total_tool_calls=int(meta_row.tool_calls or 0) if meta_row else 0,
        total_tool_errors=int(meta_row.tool_errors or 0) if meta_row else 0,
        total_subagents_spawned=int(meta_row.subagents_spawned or 0) if meta_row else 0,
        total_compactions=int(meta_row.compactions or 0) if meta_row else 0,
        total_resets=int(meta_row.resets or 0) if meta_row else 0,
        top_tools=top_tools,
    )
