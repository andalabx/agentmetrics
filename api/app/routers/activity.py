import asyncio
import json
import secrets
import threading
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.activity_store import store
from app.database import get_db
from app.deps import get_current_org_from_api_key, get_current_org_from_jwt
from app.models.organization import Organization
from app.schemas.activity import ActivityEvent

router = APIRouter(prefix="/activity", tags=["activity"])

# Short-lived SSE tickets: ticket -> (org_id, expires_at)
_tickets: dict[str, tuple[str, datetime]] = {}
_tickets_lock = threading.Lock()


def _issue_ticket(org_id: str) -> str:
    ticket = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=30)
    with _tickets_lock:
        # Purge expired tickets
        now = datetime.now(timezone.utc)
        expired = [t for t, (_, exp) in _tickets.items() if exp < now]
        for t in expired:
            del _tickets[t]
        _tickets[ticket] = (org_id, expires_at)
    return ticket


def _consume_ticket(ticket: str) -> str | None:
    """Consume a ticket exactly once. Returns org_id or None if invalid/expired."""
    with _tickets_lock:
        # Purge all expired tickets while the lock is held (cheap, bounded set)
        now = datetime.now(timezone.utc)
        expired = [t for t, (_, exp) in _tickets.items() if exp < now]
        for t in expired:
            del _tickets[t]
        entry = _tickets.pop(ticket, None)
    if not entry:
        return None
    org_id, expires_at = entry
    if datetime.now(timezone.utc) > expires_at:
        return None
    return org_id


@router.post("", status_code=202)
def ingest_activity(
    body: ActivityEvent,
    org: Organization = Depends(get_current_org_from_api_key),
):
    store.publish(str(org.id), {"org_id": str(org.id), **body.model_dump()})
    return {"ok": True}


@router.post("/ticket", status_code=201)
def create_sse_ticket(
    org: Organization = Depends(get_current_org_from_jwt),
):
    """Exchange a JWT for a 30-second single-use SSE ticket, keeping JWTs out of URLs."""
    return {"ticket": _issue_ticket(str(org.id))}


@router.get("/live")
async def stream_live(
    ticket: str = Query(..., description="Single-use SSE ticket from POST /activity/ticket"),
    db: Session = Depends(get_db),
):
    """
    SSE endpoint - streams real-time activity events to the dashboard.

    Authenticated via a short-lived single-use ticket (not a JWT) to keep
    credentials out of server access logs and CDN request logs.

    On connect: replays the 200 most recent events for this org.
    """
    org_id = _consume_ticket(ticket)
    if not org_id:
        raise HTTPException(status_code=401, detail="Invalid or expired ticket")

    async def generate():
        loop = asyncio.get_running_loop()
        q = store.subscribe(org_id)

        for event in store.recent(org_id):
            yield f"data: {json.dumps(event)}\n\n"

        try:
            while True:
                def _get_event():
                    try:
                        return q.get(timeout=25)
                    except Exception:
                        return None

                event = await loop.run_in_executor(None, _get_event)
                if event is not None:
                    yield f"data: {json.dumps(event)}\n\n"
                else:
                    yield ": heartbeat\n\n"

        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            store.unsubscribe(org_id, q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
