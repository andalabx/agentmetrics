"""
Stats endpoint - monthly cost, event counts, historical spend.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.database import IS_SQLITE, get_db
from app.deps import get_current_org_from_jwt
from app.models.organization import Organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stats", tags=["stats"])

@router.get("/monthly")
def get_monthly_stats(
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Return current-month and last-month cost + event counts.
    Also returns the last 6 months of spend history.
    """
    org_id = str(org.id)

    if IS_SQLITE:
        # Monthly aggregation tables use PostgreSQL-only SQL; return live counts directly
        import uuid

        from sqlalchemy import func

        from app.models.event import Event
        try:
            org_uuid = uuid.UUID(org_id) if isinstance(org_id, str) else org_id
            total = db.query(
                func.count(Event.id).label("event_count"),
                func.coalesce(func.sum(Event.cost_usd), 0).label("total_cost"),
            ).filter(Event.org_id == org_uuid).one()
            result = {
                "this_month":  {"event_count": int(total.event_count), "total_cost_usd": float(total.total_cost)},
                "last_month":  {"event_count": 0, "total_cost_usd": 0.0},
                "history":     [],
                "alltime":     {"event_count": int(total.event_count), "total_cost_usd": float(total.total_cost)},
            }
            return result
        except Exception as exc:
            logger.warning("[stats] SQLite monthly fallback failed: %s", exc)
            return {"this_month": {}, "last_month": {}, "history": [], "alltime": {}}

    try:
        # Current month
        current = db.execute(text("""
            SELECT event_count, COALESCE(total_cost_usd, 0) AS total_cost_usd
            FROM monthly_usage
            WHERE org_id = :org_id
              AND year_month = to_char(date_trunc('month', now()), 'YYYY-MM')
        """), {"org_id": org_id}).fetchone()

        # Previous month
        prev = db.execute(text("""
            SELECT event_count, COALESCE(total_cost_usd, 0) AS total_cost_usd
            FROM monthly_usage
            WHERE org_id = :org_id
              AND year_month = to_char(date_trunc('month', now()) - INTERVAL '1 month', 'YYYY-MM')
        """), {"org_id": org_id}).fetchone()

        # Last 6 months history
        history_rows = db.execute(text("""
            SELECT year_month, event_count, COALESCE(total_cost_usd, 0) AS total_cost_usd
            FROM monthly_usage
            WHERE org_id = :org_id
              AND year_month >= to_char(date_trunc('month', now()) - INTERVAL '5 months', 'YYYY-MM')
            ORDER BY year_month ASC
        """), {"org_id": org_id}).fetchall()

        # All-time total (from events table, always accurate)
        alltime = db.execute(text("""
            SELECT COUNT(*) AS event_count, COALESCE(SUM(cost_usd), 0) AS total_cost
            FROM events
            WHERE org_id = :org_id
              AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
        """), {"org_id": org_id}).fetchone()

        result = {
            "this_month": {
                "event_count":    int(current[0]) if current else 0,
                "total_cost_usd": float(current[1]) if current else 0.0,
            },
            "last_month": {
                "event_count":    int(prev[0]) if prev else 0,
                "total_cost_usd": float(prev[1]) if prev else 0.0,
            },
            "history": [
                {
                    "month":        row[0],
                    "event_count":  int(row[1]),
                    "total_cost_usd": float(row[2]),
                }
                for row in history_rows
            ],
            "all_time": {
                "event_count":    int(alltime[0]) if alltime else 0,
                "total_cost_usd": float(alltime[1]) if alltime else 0.0,
            },
        }
        return result
    except (ProgrammingError, OperationalError):
        # monthly_usage view not yet created - expected on fresh deploys
        db.rollback()
        return {
            "this_month":  {"event_count": 0, "total_cost_usd": 0.0},
            "last_month":  {"event_count": 0, "total_cost_usd": 0.0},
            "history":     [],
            "all_time":    {"event_count": 0, "total_cost_usd": 0.0},
        }
    except Exception:
        db.rollback()
        logger.exception("[stats] Unexpected error fetching monthly stats for org %s", org_id)
        raise HTTPException(status_code=500, detail="Failed to load stats") from None

@router.get("/daily-cost")
def get_daily_cost(
    days: int = 30,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return daily cost totals for the last N days."""
    org_id = str(org.id)
    days = max(7, min(days, 90))  # clamp 7-90

    if IS_SQLITE:
        import uuid as _uuid
        from datetime import timedelta

        from sqlalchemy import Date, cast, func

        from app.models.event import Event

        try:
            org_uuid = _uuid.UUID(org_id) if isinstance(org_id, str) else org_id
            cutoff = datetime.now(UTC) - timedelta(days=days)
            rows = (
                db.query(
                    cast(Event.timestamp, Date).label("day"),
                    func.coalesce(func.sum(Event.cost_usd), 0).label("cost"),
                    func.count(Event.id).label("runs"),
                )
                .filter(Event.org_id == org_uuid, Event.timestamp >= cutoff)
                .group_by(cast(Event.timestamp, Date))
                .order_by(cast(Event.timestamp, Date))
                .all()
            )
            return [{"date": str(r.day), "cost_usd": float(r.cost), "runs": int(r.runs)} for r in rows]
        except Exception as exc:
            logger.warning("[stats] SQLite daily-cost failed: %s", exc)
            return []

    try:
        rows = db.execute(text("""
            SELECT
                DATE(timestamp AT TIME ZONE 'UTC') AS day,
                COALESCE(SUM(cost_usd), 0)         AS cost_usd,
                COUNT(*)                            AS runs
            FROM events
            WHERE org_id = :org_id
              AND timestamp >= NOW() - (:days || ' days')::interval
            GROUP BY day
            ORDER BY day ASC
        """), {"org_id": org_id, "days": days}).fetchall()
        return [{"date": str(r[0]), "cost_usd": float(r[1]), "runs": int(r[2])} for r in rows]
    except Exception:
        db.rollback()
        return []


@router.get("/week-comparison")
def get_week_comparison(
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Current 7 days vs previous 7 days: error rate, cost, run count, avg duration."""
    org_id = str(org.id)

    if IS_SQLITE:
        import uuid as _uuid
        from datetime import timedelta

        from sqlalchemy import case, func

        from app.models.event import Event
        try:
            org_uuid = _uuid.UUID(org_id) if isinstance(org_id, str) else org_id
            cutoff_7d = datetime.now(UTC) - timedelta(days=7)
            cutoff_14d = datetime.now(UTC) - timedelta(days=14)
            cur = db.query(
                func.count(Event.id).label("runs"),
                func.coalesce(func.sum(Event.cost_usd), 0).label("cost"),
                func.avg(Event.duration_ms).label("duration_ms"),
                func.avg(case((Event.status == "failed", 1.0), else_=0.0)).label("error_rate"),
            ).filter(Event.org_id == org_uuid, Event.timestamp >= cutoff_7d).one()
            prev = db.query(
                func.count(Event.id).label("runs"),
                func.coalesce(func.sum(Event.cost_usd), 0).label("cost"),
                func.avg(Event.duration_ms).label("duration_ms"),
                func.avg(case((Event.status == "failed", 1.0), else_=0.0)).label("error_rate"),
            ).filter(Event.org_id == org_uuid, Event.timestamp >= cutoff_14d, Event.timestamp < cutoff_7d).one()

            def pct(c: int | float | None, p: int | float | None) -> float | None:
                if not p:
                    return None
                return round(((float(c or 0) - float(p or 0)) / float(p)) * 100, 1)

            result = {
                "runs":        {"current": cur.runs, "previous": prev.runs, "pct_change": pct(cur.runs, prev.runs)},
                "cost_usd":    {"current": round(float(cur.cost), 6), "previous": round(float(prev.cost), 6), "pct_change": pct(cur.cost, prev.cost)},
                "error_rate":  {"current": round(float(cur.error_rate or 0) * 100, 2), "previous": round(float(prev.error_rate or 0) * 100, 2), "pct_change": None},
                "duration_ms": {"current": round(float(cur.duration_ms or 0), 1), "previous": round(float(prev.duration_ms or 0), 1), "pct_change": pct(cur.duration_ms, prev.duration_ms)},
            }
            return result
        except Exception as exc:
            logger.warning("[stats] SQLite week-comparison fallback: %s", exc)
            return {"runs": {}, "cost_usd": {}, "error_rate": {}, "duration_ms": {}}

    try:
        row = db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE timestamp >= now() - INTERVAL '7 days')                                    AS cur_runs,
                COUNT(*) FILTER (WHERE timestamp >= now() - INTERVAL '14 days'
                                   AND timestamp <  now() - INTERVAL '7 days')                                    AS prev_runs,
                COALESCE(SUM(cost_usd) FILTER (WHERE timestamp >= now() - INTERVAL '7 days'), 0)                  AS cur_cost,
                COALESCE(SUM(cost_usd) FILTER (WHERE timestamp >= now() - INTERVAL '14 days'
                                               AND  timestamp <  now() - INTERVAL '7 days'), 0)                   AS prev_cost,
                AVG(CASE WHEN status = 'failed' AND timestamp >= now() - INTERVAL '7 days'
                         THEN 1.0 ELSE 0.0 END)                                                                   AS cur_error_rate,
                AVG(CASE WHEN status = 'failed'
                          AND timestamp >= now() - INTERVAL '14 days'
                          AND timestamp <  now() - INTERVAL '7 days'
                         THEN 1.0 ELSE 0.0 END)                                                                   AS prev_error_rate,
                AVG(duration_ms) FILTER (WHERE timestamp >= now() - INTERVAL '7 days')                            AS cur_duration_ms,
                AVG(duration_ms) FILTER (WHERE timestamp >= now() - INTERVAL '14 days'
                                           AND timestamp <  now() - INTERVAL '7 days')                            AS prev_duration_ms
            FROM events
            WHERE org_id = :org_id
              AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
        """), {"org_id": org_id}).fetchone()

        def pct_change(cur: int | float | None, prev: int | float | None) -> float | None:
            if prev is None or prev == 0:
                return None
            return round(((cur - prev) / prev) * 100, 1)

        result = {
            "current": {
                "runs":       int(row[0] or 0),
                "cost":       float(row[2] or 0),
                "error_rate": float(row[4] or 0),
                "duration_ms": float(row[6]) if row[6] is not None else None,
            },
            "previous": {
                "runs":       int(row[1] or 0),
                "cost":       float(row[3] or 0),
                "error_rate": float(row[5] or 0),
                "duration_ms": float(row[7]) if row[7] is not None else None,
            },
            "delta": {
                "runs_pct":       pct_change(row[0] or 0, row[1] or 0),
                "cost_pct":       pct_change(row[2] or 0, row[3] or 0),
                "error_rate_pct": pct_change(row[4] or 0, row[5] or 0),
                "duration_pct":   pct_change(row[6], row[7]),
            },
        }
        return result
    except Exception:
        db.rollback()
        return {"current": {}, "previous": {}, "delta": {}}


def _stats_by_dimension(
    field: str,
    window_hours: int,
    org: Organization,
    db: Session,
) -> dict[str, Any]:
    """Shared implementation for all by-dimension stat endpoints."""
    org_id = str(org.id)
    try:
        if IS_SQLITE:
            import uuid as _uuid
            from datetime import timedelta

            from sqlalchemy import case, func

            from app.models.event import Event as _Event

            org_uuid = _uuid.UUID(org_id) if isinstance(org_id, str) else org_id
            cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
            dim_col = getattr(_Event, field)
            rows = (
                db.query(
                    dim_col.label("dim"),
                    func.count(_Event.id).label("runs"),
                    func.coalesce(func.sum(_Event.cost_usd), 0).label("cost_usd"),
                    func.avg(_Event.duration_ms).label("avg_duration_ms"),
                    func.sum(case((_Event.status == "failed", 1), else_=0)).label("failed_runs"),
                )
                .filter(_Event.org_id == org_uuid, _Event.timestamp >= cutoff, dim_col.isnot(None))
                .group_by(dim_col)
                .order_by(func.coalesce(func.sum(_Event.cost_usd), 0).desc())
                .limit(100)
                .all()
            )
            items = [
                {
                    "name": str(r.dim),
                    "runs": int(r.runs),
                    "cost_usd": float(r.cost_usd),
                    "avg_duration_ms": float(r.avg_duration_ms) if r.avg_duration_ms is not None else None,
                    "failed_runs": int(r.failed_runs),
                }
                for r in rows
            ]
        else:
            # field is always one of the four hardcoded values — safe to interpolate
            rows = db.execute(text(f"""
                SELECT {field} AS dim, COUNT(*) AS runs,
                       COALESCE(SUM(cost_usd),0) AS cost_usd,
                       AVG(duration_ms) AS avg_duration_ms,
                       COUNT(*) FILTER (WHERE status='failed') AS failed_runs
                FROM events
                WHERE org_id=:org_id
                  AND timestamp >= now() - (:wh * INTERVAL '1 hour')
                  AND {field} IS NOT NULL
                GROUP BY {field} ORDER BY cost_usd DESC LIMIT 100
            """), {"org_id": org_id, "wh": window_hours}).fetchall()
            items = [
                {
                    "name": str(r[0]),
                    "runs": int(r[1]),
                    "cost_usd": float(r[2]),
                    "avg_duration_ms": float(r[3]) if r[3] is not None else None,
                    "failed_runs": int(r[4]),
                }
                for r in rows
            ]
        return {"dimension_name": field, "window_hours": window_hours, "items": items}
    except Exception:
        db.rollback()
        logger.exception("[stats] by-%s failed for org %s", field, org_id)
        return {"dimension_name": field, "window_hours": window_hours, "items": []}


@router.get("/by-workflow")
def get_stats_by_workflow(
    window_hours: int = Query(default=24, ge=1, le=720),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _stats_by_dimension("workflow_id", window_hours, org, db)


@router.get("/by-skill")
def get_stats_by_skill(
    window_hours: int = Query(default=24, ge=1, le=720),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _stats_by_dimension("skill_name", window_hours, org, db)


@router.get("/by-toolset")
def get_stats_by_toolset(
    window_hours: int = Query(default=24, ge=1, le=720),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _stats_by_dimension("toolset", window_hours, org, db)


@router.get("/by-host")
def get_stats_by_host(
    window_hours: int = Query(default=24, ge=1, le=720),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _stats_by_dimension("host_id", window_hours, org, db)
