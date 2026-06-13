from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_org_from_jwt
from app.models.organization import Organization
from app.schemas.agent import Recommendation
from app.services.agent_service import get_agents_summary
from app.services.recommendation_service import enrich_agents_data, run_basic_rules

router = APIRouter(prefix="/recommendations", tags=["recommendations"])

class StatusUpdate(BaseModel):
    status: str  # open | in_progress | resolved | dismissed

@router.get("", response_model=list[Recommendation])
def get_recommendations(
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    agents = get_agents_summary(str(org.id), db)
    agents_data = [a.model_dump() for a in agents]
    agents_data = enrich_agents_data(str(org.id), agents_data, db)
    recs = [r.model_dump() for r in run_basic_rules(agents_data)]
    now = datetime.now(UTC)
    result = []
    for rec in recs:
        obj = Recommendation.model_validate(rec) if isinstance(rec, dict) else rec
        if obj.calculated_at is None:
            obj.calculated_at = now
        result.append(obj)
    return result

@router.patch("/{recommendation_id}", response_model=dict)
def update_recommendation_status(
    recommendation_id: str,
    body: StatusUpdate,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """Update the status of a recommendation (open/in_progress/resolved/dismissed)."""
    valid_statuses = {"open", "in_progress", "resolved", "dismissed"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=422, detail=f"status must be one of {valid_statuses}")

    try:
        from sqlalchemy import text
        result = db.execute(
            text(
                "UPDATE recommendations SET status = :status, updated_at = now() "
                "WHERE id = :id AND org_id = :org_id"
            ),
            {"status": body.status, "id": recommendation_id, "org_id": str(org.id)},
        )
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Recommendation not found")
    except HTTPException:
        raise
    except Exception:
        db.rollback()

    return {"id": recommendation_id, "status": body.status}
