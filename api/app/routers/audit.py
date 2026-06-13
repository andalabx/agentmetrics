"""
Security audit stream - surfaces redaction policy usage across agent runs.

Useful for compliance review: shows which policy versions are active, flags
any runs collected under debug mode (full data exposure), and reports
platform/agent coverage.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_org_from_jwt
from app.models.organization import Organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audit", tags=["audit"])

@router.get("")
def get_audit_stream(
    window_hours: int = Query(default=168, ge=1, le=2160),  # default 7 days
    agent_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """
    Security audit stream for redaction policy usage.

    Returns a summary of redaction policy versions, platform distribution,
    and a list of recent runs flagged for security review (debug mode, missing
    policy version, or unknown platform).

    window_hours - look-back window in hours (1-2160, default 168 = 7 days).
    agent_id    - filter to a specific agent (optional).
    limit       - max number of flagged events to return (1-1000, default 100).
    """
    org_id = str(org.id)
    try:
        # agent_filter interpolates only the hardcoded string "AND agent_id = :agent_id"
        # or "". The actual agent_id value always travels through a bind parameter.
        agent_filter     = "AND agent_id = :agent_id" if agent_id else ""
        agent_params: dict = {"org_id": org_id, "wh": window_hours}
        if agent_id:
            agent_params["agent_id"] = agent_id

        policy_rows = db.execute(text(f"""
            SELECT
                COALESCE(run_metadata->>'redaction_policy_version', 'unknown') AS policy_version,
                COUNT(*)                                                        AS cnt
            FROM events
            WHERE org_id   = :org_id
              AND timestamp >= now() - (:wh * INTERVAL '1 hour')
              {agent_filter}
            GROUP BY policy_version
            ORDER BY cnt DESC
        """), agent_params).fetchall()

        platform_rows = db.execute(text(f"""
            SELECT
                COALESCE(run_metadata->>'platform', 'unknown') AS platform,
                COUNT(*)                                        AS cnt
            FROM events
            WHERE org_id   = :org_id
              AND timestamp >= now() - (:wh * INTERVAL '1 hour')
              {agent_filter}
            GROUP BY platform
            ORDER BY cnt DESC
        """), agent_params).fetchall()

        # Flags: debug mode (data exposure risk), no policy version (unversioned
        # clients), or unknown platform (possible unmanaged integration).
        flagged_rows = db.execute(text(f"""
            SELECT
                trace_id,
                agent_id,
                timestamp,
                run_metadata->>'redaction_policy_version' AS policy_version,
                run_metadata->>'platform'                 AS platform,
                run_metadata->>'event_name'               AS event_name,
                CASE
                    WHEN run_metadata->>'redaction_policy_version' LIKE '%-debug'
                        THEN 'debug_mode'
                    WHEN run_metadata->>'redaction_policy_version' IS NULL
                        THEN 'no_policy_version'
                    ELSE 'unknown_platform'
                END AS flag_reason
            FROM events
            WHERE org_id   = :org_id
              AND timestamp >= now() - (:wh * INTERVAL '1 hour')
              {agent_filter}
              AND (
                  run_metadata->>'redaction_policy_version' LIKE '%-debug'
                  OR run_metadata->>'redaction_policy_version' IS NULL
                  OR run_metadata->>'platform' IS NULL
              )
            ORDER BY timestamp DESC
            LIMIT :limit
        """), {**agent_params, "limit": limit}).fetchall()

        totals_row = db.execute(text(f"""
            SELECT
                COUNT(*)                                                                            AS total,
                COUNT(*) FILTER (WHERE run_metadata->>'redaction_policy_version' LIKE '%-debug')   AS debug_count,
                COUNT(*) FILTER (WHERE run_metadata->>'redaction_policy_version' IS NULL)           AS no_policy_count,
                COUNT(DISTINCT agent_id)                                                            AS agent_count
            FROM events
            WHERE org_id   = :org_id
              AND timestamp >= now() - (:wh * INTERVAL '1 hour')
              {agent_filter}
        """), agent_params).fetchone()

        result = {
            "window_hours": window_hours,
            "agent_filter": agent_id,
            "summary": {
                "total_runs":       int(totals_row[0] or 0),
                "debug_runs":       int(totals_row[1] or 0),
                "no_policy_runs":   int(totals_row[2] or 0),
                "agents_covered":   int(totals_row[3] or 0),
            },
            "policy_versions": {
                row[0]: int(row[1]) for row in policy_rows
            },
            "platforms": {
                row[0]: int(row[1]) for row in platform_rows
            },
            "flagged_events": [
                {
                    "trace_id":       row[0],
                    "agent_id":       row[1],
                    "timestamp":      row[2].isoformat() if row[2] else None,
                    "policy_version": row[3],
                    "platform":       row[4],
                    "event_name":     row[5],
                    "flag_reason":    row[6],
                }
                for row in flagged_rows
            ],
        }
        return result

    except Exception:
        db.rollback()
        logger.exception("[audit] Unexpected error for org %s", org_id)
        raise HTTPException(status_code=500, detail="Failed to load audit data") from None
