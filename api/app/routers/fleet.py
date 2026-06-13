"""
Health score and daily briefing endpoints.
"""
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import IS_SQLITE, get_db
from app.deps import get_current_org_from_jwt
from app.models.organization import Organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fleet", tags=["fleet"])

def _compute_fleet_score(agents: list, cost_delta_pct, alert_count_24h: int, latency_cv: float) -> dict:
    """
    Composite Health Score 0-100:
      success_rate_component   (40%) - avg success rate across all agents
      cost_efficiency_component(30%) - penalised by cost growth vs last week
      alert_frequency_component(20%) - penalised by alert firings in last 24h
      latency_stability_component(10%) -  penalised by high latency variance (CV)
    """
    if not agents:
        return {"score": 100, "breakdown": {"success": 40, "cost": 30, "alerts": 20, "latency": 10}}

    avg_sr = sum(a["success_rate"] for a in agents) / len(agents)
    success_component = (avg_sr / 100) * 40

    if cost_delta_pct is None or cost_delta_pct <= 0:
        cost_component = 30.0
    elif cost_delta_pct <= 20:
        cost_component = 30 - (cost_delta_pct / 20) * 10
    elif cost_delta_pct <= 100:
        cost_component = 20 - ((cost_delta_pct - 20) / 80) * 20
    else:
        cost_component = 0.0

    if alert_count_24h == 0:
        alert_component = 20.0
    elif alert_count_24h <= 3:
        alert_component = 20 - (alert_count_24h / 3) * 10
    else:
        alert_component = max(0.0, 10 - (alert_count_24h - 3) * 2)

    if latency_cv is None or latency_cv <= 0.2:
        latency_component = 10.0
    elif latency_cv <= 0.5:
        latency_component = 10 - ((latency_cv - 0.2) / 0.3) * 5
    else:
        latency_component = max(0.0, 5 - (latency_cv - 0.5) * 10)

    total = round(success_component + cost_component + alert_component + latency_component, 1)

    return {
        "score": min(100, max(0, total)),
        "breakdown": {
            "success":  round(success_component, 1),
            "cost":     round(cost_component, 1),
            "alerts":   round(alert_component, 1),
            "latency":  round(latency_component, 1),
        },
    }

@router.get("/health")
def get_fleet_health(
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """Health Score (0-100) with component breakdown."""
    org_id = str(org.id)

    try:
        if IS_SQLITE:
            import uuid as _uuid
            from datetime import timedelta

            from sqlalchemy import case, func

            from app.models.event import Event
            org_uuid = _uuid.UUID(org_id) if isinstance(org_id, str) else org_id
            cutoff_7d = datetime.now(UTC) - timedelta(days=7)
            agent_rows = (
                db.query(
                    Event.agent_id,
                    func.count(Event.id).label("total_calls"),
                    func.sum(case((Event.status == "failed", 1), else_=0)).label("failed"),
                    (100.0 * func.sum(case((Event.status == "success", 1), else_=0)) /
                     func.nullif(func.count(Event.id), 0)).label("success_rate"),
                )
                .filter(Event.org_id == org_uuid, Event.timestamp >= cutoff_7d)
                .group_by(Event.agent_id)
                .all()
            )
            agents = [{"agent_id": r.agent_id, "total_calls": r.total_calls, "failed": r.failed or 0, "success_rate": float(r.success_rate or 100)} for r in agent_rows]
            cur_cost = float(db.query(func.coalesce(func.sum(Event.cost_usd), 0)).filter(Event.org_id == org_uuid, Event.timestamp >= cutoff_7d).scalar() or 0)
            cost_delta_pct = None
            alert_count_24h = 0
            latency_cv = 0.0
        else:
            agent_rows = db.execute(text("""
                SELECT
                    agent_id,
                    COUNT(*) AS total_calls,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                    ROUND(
                        100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)
                        / NULLIF(COUNT(*), 0),
                        2
                    ) AS success_rate
                FROM events
                WHERE org_id = :org_id
                  AND timestamp >= NOW() - INTERVAL '7 days'
                  AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
                GROUP BY agent_id
            """), {"org_id": org_id}).mappings().all()
            agents = [dict(r) for r in agent_rows]

            cost_row = db.execute(text("""
                SELECT
                    COALESCE(SUM(cost_usd) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days'), 0)  AS cur_cost,
                    COALESCE(SUM(cost_usd) FILTER (
                        WHERE timestamp >= NOW() - INTERVAL '14 days'
                          AND timestamp <  NOW() - INTERVAL '7 days'), 0) AS prev_cost
                FROM events WHERE org_id = :org_id
                  AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
            """), {"org_id": org_id}).fetchone()
            cur_cost, prev_cost = float(cost_row[0] or 0), float(cost_row[1] or 0)
            cost_delta_pct = None
            if prev_cost > 0:
                cost_delta_pct = ((cur_cost - prev_cost) / prev_cost) * 100

            alert_row = db.execute(text("""
                SELECT COUNT(*) FROM alert_history
                WHERE org_id = :org_id AND fired_at >= NOW() - INTERVAL '24 hours'
            """), {"org_id": org_id}).fetchone()
            alert_count_24h = int(alert_row[0] or 0)

            latency_row = db.execute(text("""
                SELECT STDDEV(duration_ms), AVG(duration_ms)
                FROM events
                WHERE org_id = :org_id
                  AND duration_ms IS NOT NULL
                  AND timestamp >= NOW() - INTERVAL '7 days'
                  AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
            """), {"org_id": org_id}).fetchone()
            stddev, avg_dur = latency_row[0], latency_row[1]
            latency_cv = None
            if avg_dur and avg_dur > 0 and stddev is not None:
                latency_cv = float(stddev) / float(avg_dur)

        health = _compute_fleet_score(agents, cost_delta_pct, alert_count_24h, latency_cv)

        healthy  = sum(1 for a in agents if float(a.get("success_rate") or 0) >= 95)
        degraded = sum(1 for a in agents if 80 <= float(a.get("success_rate") or 0) < 95)
        critical = sum(1 for a in agents if float(a.get("success_rate") or 0) < 80)

        result = {
            **health,
            "agent_count":     len(agents),
            "healthy_count":   healthy,
            "degraded_count":  degraded,
            "critical_count":  critical,
            "alert_count_24h": alert_count_24h,
            "cost_delta_pct":  round(cost_delta_pct, 1) if cost_delta_pct is not None else None,
        }
        return result
    except Exception:
        logger.exception("[fleet] health score failed for org %s", org_id)
        return {"score": 100, "breakdown": {"success": 40, "cost": 30, "alerts": 20, "latency": 10},
                "agent_count": 0, "healthy_count": 0, "degraded_count": 0, "critical_count": 0,
                "alert_count_24h": 0, "cost_delta_pct": None}

@router.get("/briefing")
def get_fleet_briefing(
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """Template-generated morning briefing narrative."""
    org_id = str(org.id)

    try:
        stats_row = db.execute(text("""
            SELECT
                COUNT(*)                                                         AS total_runs,
                COUNT(DISTINCT agent_id)                                         AS agent_count,
                COALESCE(SUM(cost_usd), 0)                                       AS total_cost,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)              AS failed_runs,
                MAX(timestamp)                                                   AS last_event
            FROM events
            WHERE org_id = :org_id
              AND timestamp >= NOW() - INTERVAL '24 hours'
              AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
        """), {"org_id": org_id}).fetchone()

        total_runs  = int(stats_row[0] or 0)
        agent_count = int(stats_row[1] or 0)
        total_cost  = float(stats_row[2] or 0)
        failed_runs = int(stats_row[3] or 0)

        alert_row = db.execute(text("""
            SELECT COUNT(*) FROM alert_history
            WHERE org_id = :org_id AND fired_at >= NOW() - INTERVAL '24 hours'
        """), {"org_id": org_id}).fetchone()
        alert_count = int(alert_row[0] or 0)

        rec_row = db.execute(text("""
            SELECT COUNT(*) FROM recommendations
            WHERE org_id = :org_id AND status = 'open'
        """), {"org_id": org_id}).fetchone()
        rec_count = int(rec_row[0] or 0)

        top_cost_row = db.execute(text("""
            SELECT agent_id, COALESCE(SUM(cost_usd), 0) AS cost
            FROM events
            WHERE org_id = :org_id
              AND timestamp >= NOW() - INTERVAL '24 hours'
              AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
            GROUP BY agent_id
            ORDER BY cost DESC
            LIMIT 1
        """), {"org_id": org_id}).fetchone()

        hour = datetime.utcnow().hour
        if hour < 12:
            greeting = "Good morning"
        elif hour < 18:
            greeting = "Good afternoon"
        else:
            greeting = "Good evening"

        if total_runs == 0:
            headline = "No agent activity in the last 24 hours."
            body = "Your agents are idle. Deploy an agent or check your integration to start collecting data."
        else:
            success_rate = ((total_runs - failed_runs) / total_runs * 100) if total_runs > 0 else 100
            run_str   = f"{total_runs:,} run{'s' if total_runs != 1 else ''}"
            agent_str = f"{agent_count} agent{'s' if agent_count != 1 else ''}"
            cost_str  = f"${total_cost:.4f}" if total_cost < 0.01 else f"${total_cost:.2f}"

            if success_rate >= 99:
                status_phrase = "running perfectly"
            elif success_rate >= 95:
                status_phrase = "mostly healthy"
            elif success_rate >= 80:
                status_phrase = "showing some degradation"
            else:
                status_phrase = "under stress"

            headline = f"{greeting}. Your agents ran {run_str} across {agent_str} in the last 24 hours, {status_phrase}."

            parts = []
            if failed_runs > 0:
                parts.append(f"{failed_runs} run{'s' if failed_runs != 1 else ''} failed ({100 - success_rate:.1f}% error rate)")
            if total_cost > 0:
                parts.append(f"total spend was {cost_str}")
            if alert_count > 0:
                parts.append(f"{alert_count} alert{'s' if alert_count != 1 else ''} fired")
            if top_cost_row and top_cost_row[1] > 0:
                parts.append(f"top cost driver was '{top_cost_row[0]}'")

            body = ". ".join(p.capitalize() for p in parts) + ("." if parts else "")

        cta = None
        if rec_count > 0:
            cta = f"{rec_count} optimization recommendation{'s are' if rec_count != 1 else ' is'} waiting for your review."

        result = {
            "headline": headline,
            "body":     body,
            "cta":      cta,
            "stats": {
                "total_runs":   total_runs,
                "agent_count":  agent_count,
                "total_cost":   round(total_cost, 6),
                "failed_runs":  failed_runs,
                "alert_count":  alert_count,
                "rec_count":    rec_count,
            },
        }
        return result
    except Exception:
        logger.exception("[fleet] briefing failed for org %s", org_id)
        return {"headline": "Overview", "body": "", "cta": None, "stats": {}}
