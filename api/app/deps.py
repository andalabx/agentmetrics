import hashlib

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.organization import Organization


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _extract_key(authorization: str | None, x_api_key: str | None) -> str | None:
    """Pull the raw key from Authorization: Bearer <key> or X-API-Key: <key>."""
    if authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()
    return x_api_key or None


def get_current_org_from_api_key(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    db: Session = Depends(get_db),
) -> Organization:
    """Validate the API key and return the owning org. Used by ingest + dashboard routes."""
    raw_key = _extract_key(authorization, x_api_key)
    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required — pass 'Authorization: Bearer <key>' or 'X-API-Key: <key>'",
            headers={"WWW-Authenticate": "Bearer"},
        )
    key_hash = _hash_key(raw_key)
    org = db.query(Organization).filter(Organization.sdk_key_hash == key_hash).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return org


# Dashboard routes were originally wired to a JWT dep.
# For single-tenant self-hosted, the same API key serves both SDK and dashboard.
get_current_org_from_jwt = get_current_org_from_api_key


def get_default_org(db: Session = Depends(get_db)) -> Organization:
    """
    Unauthenticated org lookup — for the /health endpoint only.
    Every other route must use get_current_org_from_api_key.
    """
    org = db.query(Organization).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not initialized — restart to provision the default organization",
        )
    return org
