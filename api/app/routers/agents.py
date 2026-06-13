from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel

from app.database import get_db, IS_SQLITE
from app.db_compat import trunc_hour, interval_hours_ago
from app.models.organization import Organization
from app.models.event import Event
from app.schemas.agent import AgentSummary, AgentDetail
from app.services.agent_service import get_agents_summary, get_agent_detail
from app.deps import get_current_org_from_jwt

router = APIRouter(prefix="/agents", tags=["agents"])

class RenameAgentRequest(BaseModel):
    name: str

@router.get("", response_model=list[AgentSummary])
def list_agents(
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    result = [a.model_dump() for a in get_agents_summary(str(org.id), db, limit=limit, offset=offset)]
    return result

@router.get("/names", response_model=dict[str, str])
def get_agent_names(
    org: Organization = Depends(get_current_org_from_jwt),
):
    """Return the org's custom agent name map: { agent_id: display_name }"""
    settings = org.settings or {}
    return settings.get("agent_names", {})

@router.get("/{agent_id}/hourly")
def get_hourly_runs(
    agent_id: str,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """Return run counts and cost bucketed by hour for the last 24 hours."""
    since_expr = interval_hours_ago(24)
    if IS_SQLITE:
        rows = db.execute(text(f"""
            SELECT
                strftime('%Y-%m-%dT%H:00:00', timestamp)                         AS hour,
                COUNT(*)                                                           AS runs,
                COALESCE(SUM(cost_usd), 0)                                         AS cost_usd,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)                AS failed
            FROM events
            WHERE org_id = :org_id AND agent_id = :agent_id
              AND timestamp >= {since_expr}
            GROUP BY hour ORDER BY hour
        """), {"org_id": str(org.id), "agent_id": agent_id}).mappings().all()
    else:
        rows = db.execute(text(f"""
            SELECT
                date_trunc('hour', timestamp)                                      AS hour,
                COUNT(*)                                                            AS runs,
                COALESCE(SUM(cost_usd), 0)                                          AS cost_usd,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)                 AS failed
            FROM events
            WHERE org_id = :org_id AND agent_id = :agent_id
              AND timestamp >= {since_expr}
              AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL
                   OR run_metadata->>'event_name' != 'session_metrics')
            GROUP BY hour ORDER BY hour
        """), {"org_id": str(org.id), "agent_id": agent_id}).mappings().all()
    result = [
        {
            "hour": r["hour"].strftime("%H:%M") if hasattr(r["hour"], "strftime") else str(r["hour"])[11:16],
            "runs": r["runs"],
            "cost_usd": round(float(r["cost_usd"]), 6),
            "failed": r["failed"],
        }
        for r in rows
    ]
    return result

@router.get("/{agent_id}/runs")
def list_agent_runs(
    agent_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    from app.services.agent_service import get_agent_runs
    runs, total = get_agent_runs(str(org.id), agent_id, db, limit=limit, offset=offset)
    result = {"runs": [r.model_dump() for r in runs], "total": total, "limit": limit, "offset": offset}
    return result

@router.get("/{agent_id}", response_model=AgentDetail)
def get_agent(
    agent_id: str,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    detail = get_agent_detail(str(org.id), agent_id, db)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return detail

@router.put("/{agent_id}/name", response_model=dict[str, str])
def rename_agent(
    agent_id: str,
    body: RenameAgentRequest,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """Set a custom display name for an agent. Pass empty string to reset to default."""
    name = body.name.strip()
    settings = dict(org.settings or {})
    agent_names = dict(settings.get("agent_names", {}))

    if name:
        agent_names[agent_id] = name
    else:
        agent_names.pop(agent_id, None)

    settings["agent_names"] = agent_names
    org.settings = settings
    db.add(org)
    db.commit()
    return agent_names

@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(
    agent_id: str,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    deleted = db.query(Event).filter(
        Event.org_id == org.id,
        Event.agent_id == agent_id,
    ).delete(synchronize_session=False)
    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    db.commit()
