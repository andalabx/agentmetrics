"""
SLO (Service Level Objective) endpoint - ingest pipeline health and run quality metrics.
Returns aggregate statistics for a configurable look-back window (default 24 h).
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db
from app.models.organization import Organization
from app.deps import get_current_org_from_jwt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/slo", tags=["slo"])

@router.get("")
def get_slo(
    window_hours: int = Query(default=24, ge=1, le=720),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """
    Ingest pipeline health and run quality metrics for the given look-back window.

    window_hours - look-back window in hours (1–720, default 24).
    """
    org_id  = str(org.id)

    try:
        core = db.execute(text("""
            SELECT
                COUNT(*)                                                                          AS total_runs,
                COUNT(*) FILTER (WHERE status = 'success')                                        AS success_runs,
                COUNT(*) FILTER (WHERE status = 'failed')                                         AS failed_runs,
                COUNT(*) FILTER (WHERE status NOT IN ('success', 'failed'))                       AS other_runs,
                MAX(timestamp)                                                                    AS latest_event_at,
                COUNT(DISTINCT agent_id)                                                          AS agents_active,
                PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY duration_ms)
                    FILTER (WHERE duration_ms IS NOT NULL AND duration_ms > 0)                    AS p50_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
                    FILTER (WHERE duration_ms IS NOT NULL AND duration_ms > 0)                    AS p95_ms,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms)
                    FILTER (WHERE duration_ms IS NOT NULL AND duration_ms > 0)                    AS p99_ms,
                AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL AND duration_ms > 0)       AS avg_ms,
                COALESCE(SUM(cost_usd), 0)                                                        AS total_cost_usd,
                AVG(cost_usd)       FILTER (WHERE cost_usd IS NOT NULL AND cost_usd > 0)          AS avg_cost_usd
            FROM events
            WHERE org_id       = :org_id
              AND timestamp    >= now() - (:wh * INTERVAL '1 hour')
              AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
        """), {"org_id": org_id, "wh": window_hours}).fetchone()

        agents_total_row = db.execute(text("""
            SELECT COUNT(DISTINCT agent_id) FROM events WHERE org_id = :org_id
        """), {"org_id": org_id}).fetchone()

        error_rows = db.execute(text("""
            SELECT error_message, COUNT(*) AS cnt
            FROM events
            WHERE org_id        = :org_id
              AND timestamp     >= now() - (:wh * INTERVAL '1 hour')
              AND error_message IS NOT NULL
              AND error_message != ''
              AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
            GROUP BY error_message
            ORDER BY cnt DESC
            LIMIT 5
        """), {"org_id": org_id, "wh": window_hours}).fetchall()

        trend_hours = min(window_hours, 24)
        trend_rows = db.execute(text("""
            SELECT
                date_trunc('hour', timestamp)                    AS hour,
                COUNT(*)                                          AS total,
                COUNT(*) FILTER (WHERE status = 'success')       AS successes
            FROM events
            WHERE org_id    = :org_id
              AND timestamp >= now() - (:th * INTERVAL '1 hour')
              AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
            GROUP BY 1
            ORDER BY 1 ASC
        """), {"org_id": org_id, "th": trend_hours}).fetchall()

        total      = int(core[0] or 0)
        successes  = int(core[1] or 0)
        failures   = int(core[2] or 0)
        others     = int(core[3] or 0)
        latest_at  = core[4]
        now_utc    = datetime.now(tz=timezone.utc)

        success_rate = round(successes / total, 4) if total > 0 else None
        error_rate   = round(failures  / total, 4) if total > 0 else None

        freshness_seconds = None
        if latest_at is not None:
            if latest_at.tzinfo is None:
                latest_at = latest_at.replace(tzinfo=timezone.utc)
            freshness_seconds = int((now_utc - latest_at).total_seconds())

        result = {
            "window_hours":   window_hours,
            "generated_at":   now_utc.isoformat(),
            "runs": {
                "total":        total,
                "success":      successes,
                "failed":       failures,
                "other":        others,
                "success_rate": success_rate,
                "error_rate":   error_rate,
            },
            "freshness": {
                "latest_event_at":  latest_at.isoformat() if latest_at else None,
                "age_seconds":      freshness_seconds,
                "agents_active":    int(core[5] or 0),
                "agents_total":     int(agents_total_row[0] or 0) if agents_total_row else 0,
            },
            "latency": {
                "p50_ms":  round(float(core[6]), 1)  if core[6]  is not None else None,
                "p95_ms":  round(float(core[7]), 1)  if core[7]  is not None else None,
                "p99_ms":  round(float(core[8]), 1)  if core[8]  is not None else None,
                "avg_ms":  round(float(core[9]), 1)  if core[9]  is not None else None,
            },
            "cost": {
                "total_usd":       round(float(core[10]), 6),
                "avg_per_run_usd": round(float(core[11]), 6) if core[11] is not None else None,
            },
            "top_errors": [
                {"message": row[0], "count": int(row[1])}
                for row in error_rows
            ],
            "trend": [
                {
                    "hour":         row[0].isoformat() if row[0] else None,
                    "total":        int(row[1]),
                    "successes":    int(row[2]),
                    "success_rate": round(int(row[2]) / int(row[1]), 4) if int(row[1]) > 0 else None,
                }
                for row in trend_rows
            ],
        }
        return result

    except Exception:
        db.rollback()
        logger.exception("[slo] Unexpected error for org %s", org_id)
        raise HTTPException(status_code=500, detail="Failed to load SLO data")
