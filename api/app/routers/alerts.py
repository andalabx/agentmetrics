"""
Alert rules CRUD + manual fire endpoint.
Alert evaluation runs in the background via the aggregation job.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_org_from_jwt
from app.models.organization import Organization
from app.schemas.agent import AlertRule, AlertRuleCreate, AlertRulePatch

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertRule])
def list_alert_rules(
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    from app.hooks import _provision_default_alert_rules
    _provision_default_alert_rules(str(org.id), db)

    rows = db.execute(
        text("SELECT * FROM alert_rules WHERE org_id = :org_id ORDER BY created_at ASC"),
        {"org_id": str(org.id)},
    ).mappings().all()
    return [AlertRule(**dict(r)) for r in rows]


@router.post("", response_model=AlertRule, status_code=201)
def create_alert_rule(
    body: AlertRuleCreate,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    valid_metrics = {"error_rate", "cost_usd", "duration_ms", "run_count", "loop_count"}
    valid_operators = {"gt", "lt", "gte", "lte"}
    if body.metric not in valid_metrics:
        raise HTTPException(status_code=422, detail=f"metric must be one of {valid_metrics}")
    if body.operator not in valid_operators:
        raise HTTPException(status_code=422, detail=f"operator must be one of {valid_operators}")

    rule_id = str(uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO alert_rules
                (id, org_id, agent_id, name, metric, operator, threshold,
                 window_minutes, notify_email, enabled)
            VALUES
                (:id, :org_id, :agent_id, :name, :metric, :operator, :threshold,
                 :window_minutes, :notify_email, :enabled)
        """),
        {
            "id": rule_id,
            "org_id": str(org.id),
            "agent_id": body.agent_id,
            "name": body.name,
            "metric": body.metric,
            "operator": body.operator,
            "threshold": body.threshold,
            "window_minutes": body.window_minutes,
            "notify_email": body.notify_email,
            "enabled": True,
        },
    )
    db.commit()

    row = db.execute(
        text("SELECT * FROM alert_rules WHERE id = :id"),
        {"id": rule_id},
    ).mappings().first()
    return AlertRule(**dict(row))


@router.patch("/{rule_id}", response_model=AlertRule)
def update_alert_rule(
    rule_id: str,
    body: AlertRulePatch,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    try:
        uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid rule_id") from None

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No valid fields to update")

    # Column name is safe - comes from Pydantic model field names, not user input
    _SAFE_COLS = {"name", "threshold", "window_minutes", "notify_email", "enabled"}
    set_clause = ", ".join(f"{k} = :{k}" for k in updates if k in _SAFE_COLS)
    params = {k: v for k, v in updates.items() if k in _SAFE_COLS}
    params["rule_id"] = rule_id
    params["org_id"] = str(org.id)

    result = db.execute(
        text(f"UPDATE alert_rules SET {set_clause} WHERE id = :rule_id AND org_id = :org_id"),
        params,
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Alert rule not found")

    row = db.execute(
        text("SELECT * FROM alert_rules WHERE id = :id"),
        {"id": rule_id},
    ).mappings().first()
    return AlertRule(**dict(row))


@router.delete("/{rule_id}", status_code=204)
def delete_alert_rule(
    rule_id: str,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    result = db.execute(
        text("DELETE FROM alert_rules WHERE id = :id AND org_id = :org_id"),
        {"id": rule_id, "org_id": str(org.id)},
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Alert rule not found")


@router.get("/history", response_model=list[dict])
def get_alert_history(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """Return recent fired alert events with rule context."""
    try:
        rows = db.execute(text("""
            SELECT
                ae.id,
                ae.rule_id,
                ae.value,
                ae.notified,
                ae.fired_at,
                COALESCE(r.name,         '[Deleted rule]') AS rule_name,
                COALESCE(r.metric,       'unknown')        AS metric,
                COALESCE(r.operator,     'gt')             AS operator,
                COALESCE(r.threshold,    0)                AS threshold,
                r.agent_id,
                COALESCE(r.window_minutes, 60)             AS window_minutes
            FROM alert_events ae
            LEFT JOIN alert_rules r ON r.id = ae.rule_id
            WHERE ae.org_id = :org_id
            ORDER BY ae.fired_at DESC
            LIMIT :limit OFFSET :offset
        """), {"org_id": str(org.id), "limit": limit, "offset": offset}).mappings().all()

        return [dict(r) for r in rows]
    except Exception:
        return []
