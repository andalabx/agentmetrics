from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.rate_limit import check_rate_limit
from app.database import get_db
from app.deps import get_current_org_from_api_key
from app.models.event import Event
from app.models.organization import Organization
from app.schemas.event import BatchEventCreate, BatchEventResponse, EventCreate, EventResponse

router = APIRouter(prefix="/events", tags=["events"])

def _build_event(org_id: uuid.UUID, body: EventCreate) -> Event:
    cost = body.cost_usd
    if body.model and body.input_tokens is not None and body.output_tokens is not None:
        from app.core.pricing import calculate_cost
        server_cost = calculate_cost(
            body.model,
            body.input_tokens,
            body.output_tokens,
            body.cache_read_tokens or 0,
            body.cache_write_tokens or 0,
        )
        cost = server_cost if server_cost else body.cost_usd

    # Only fields that have no dedicated column go into run_metadata.
    # Fields promoted to columns in migration 012 are excluded to avoid storing them twice.
    extra = {
        k: v for k, v in {
            "model_provider":           body.model_provider,
            "tool_names":               body.tool_names,
            "parent_trace_id":          body.parent_trace_id,
            "event_id":                 body.event_id,
            "platform":                 body.platform,
            "event_name":               body.event_name,
            "session_id":               body.session_id,
            "run_id":                   body.run_id,
            "ts":                       body.ts,
            "redaction_policy_version": body.redaction_policy_version,
            "estimated_cost_usd":       body.estimated_cost_usd,
            "sdk_version":              body.sdk_version,
        }.items() if v is not None
    }
    metadata = {**(body.metadata or {}), **extra}

    return Event(
        org_id=org_id,
        trace_id=body.trace_id,
        agent_id=body.agent_id,
        status=body.status,
        duration_ms=body.duration_ms,
        cost_usd=cost,
        model=body.model,
        input_tokens=body.input_tokens,
        output_tokens=body.output_tokens,
        error_message=body.error,
        step_count=body.step_count,
        tool_calls=body.tool_calls,
        environment=body.environment,
        version=body.version,
        run_metadata=metadata or None,
        cache_read_tokens=body.cache_read_tokens,
        cache_write_tokens=body.cache_write_tokens,
        total_tokens=body.total_tokens,
        tool_errors=body.tool_errors,
        llm_calls=body.llm_calls,
        images_count=body.images_count,
        subagents_spawned=body.subagents_spawned,
        subagent_errors=body.subagent_errors,
        compactions=body.compactions,
        resets=body.resets,
        loop_count=body.loop_count,
    )

def _run_realtime_alerts(org_id: str) -> None:
    """Background task: evaluate alert rules using a fresh DB session."""
    from app.database import SessionLocal
    from app.services.alert_service import evaluate_alerts_for_org
    db = SessionLocal()
    try:
        evaluate_alerts_for_org(org_id, db)
    finally:
        db.close()

@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def ingest_event(
    body: EventCreate,
    background_tasks: BackgroundTasks,
    response: Response,
    org: Organization = Depends(get_current_org_from_api_key),
    db: Session = Depends(get_db),
) -> EventResponse:
    check_rate_limit(str(org.id))

    existing = db.execute(
        select(Event.id).where(
            Event.org_id == org.id,
            Event.trace_id == body.trace_id,
            Event.agent_id == body.agent_id,
        ).limit(1)
    ).scalar_one_or_none()
    if existing:
        return EventResponse(status="accepted", event_id=str(existing))

    event = _build_event(org.id, body)
    db.add(event)
    db.commit()
    db.refresh(event)

    background_tasks.add_task(_run_realtime_alerts, str(org.id))

    return EventResponse(status="accepted", event_id=str(event.id))

@router.post("/batch", response_model=BatchEventResponse, status_code=status.HTTP_201_CREATED)
def ingest_events_batch(
    body: BatchEventCreate,
    background_tasks: BackgroundTasks,
    response: Response,
    org: Organization = Depends(get_current_org_from_api_key),
    db: Session = Depends(get_db),
) -> BatchEventResponse:
    """Accept up to 100 events in a single request. Partial success is allowed."""
    import logging
    _logger = logging.getLogger("agentmetrics")

    check_rate_limit(str(org.id), cost=len(body.events))

    incoming_trace_ids = [item.trace_id for item in body.events if item.trace_id]
    existing_trace_ids: set[str] = set()
    if incoming_trace_ids:
        rows = db.execute(
            select(Event.trace_id).where(
                Event.org_id == org.id,
                Event.trace_id.in_(incoming_trace_ids),
            )
        ).scalars().all()
        existing_trace_ids = set(rows)

    accepted = 0
    rejected = 0
    for item in body.events:
        if item.trace_id and item.trace_id in existing_trace_ids:
            accepted += 1
            continue
        sp = db.begin_nested()
        try:
            event = _build_event(org.id, item)
            db.add(event)
            sp.commit()
            accepted += 1
        except Exception as exc:
            sp.rollback()
            _logger.warning("[batch] Event rejected: %s", exc)
            rejected += 1

    if accepted > 0:
        db.commit()
        background_tasks.add_task(_run_realtime_alerts, str(org.id))

    return BatchEventResponse(status="accepted", accepted=accepted, rejected=rejected)
