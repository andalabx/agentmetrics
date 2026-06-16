from __future__ import annotations

import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_org_from_api_key
from app.models.organization import Organization
from app.schemas.auth import OrgResponse, RotateKeyResponse, UpdateOrgRequest

router = APIRouter(prefix="/auth", tags=["auth"])

_ALLOWED_WEBHOOK_PREFIXES = (
    "https://hooks.slack.com/",
    "https://hooks.slack-gov.com/",
)


def _validate_slack_webhook(url: str) -> str:
    """Reject URLs that don't point to Slack's webhook service (SSRF guard)."""
    stripped = url.strip()
    if not stripped:
        return ""
    if not any(stripped.startswith(p) for p in _ALLOWED_WEBHOOK_PREFIXES):
        raise HTTPException(
            status_code=422,
            detail="slack_webhook must be a Slack incoming webhook URL (https://hooks.slack.com/...)",
        )
    return stripped


@router.get("/me", response_model=OrgResponse)
def me(org: Organization = Depends(get_current_org_from_api_key)) -> OrgResponse:
    org_settings = org.settings or {}
    return OrgResponse(
        id=str(org.id),
        email=org.email,
        company_name=org.company_name,
        plan=org.plan,
        slack_webhook=org_settings.get("slack_webhook"),
    )


@router.patch("/me", response_model=OrgResponse)
def update_me(
    body: UpdateOrgRequest,
    org: Organization = Depends(get_current_org_from_api_key),
    db: Session = Depends(get_db),
) -> OrgResponse:
    if body.company_name is not None:
        org.company_name = body.company_name.strip()
    if body.slack_webhook is not None:
        org_settings = dict(org.settings or {})
        validated = _validate_slack_webhook(body.slack_webhook)
        org_settings["slack_webhook"] = validated or None
        org.settings = org_settings
    db.commit()
    db.refresh(org)
    org_settings = org.settings or {}
    return OrgResponse(
        id=str(org.id),
        email=org.email,
        company_name=org.company_name,
        plan=org.plan,
        slack_webhook=org_settings.get("slack_webhook"),
    )


@router.post("/rotate-key", response_model=RotateKeyResponse)
def rotate_key(
    org: Organization = Depends(get_current_org_from_api_key),
    db: Session = Depends(get_db),
) -> RotateKeyResponse:
    """
    Invalidate the current API key and issue a new one.
    The new raw key is returned exactly once — store it immediately.
    """
    raw_key = "am_" + secrets.token_urlsafe(32)
    org.sdk_key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    db.commit()
    return RotateKeyResponse(api_key=raw_key)
