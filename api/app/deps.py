from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.organization import Organization


def get_default_org(db: Session = Depends(get_db)) -> Organization:
    """Return the single default organization. No authentication is required."""
    org = db.query(Organization).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not initialized — restart to provision the default organization",
        )
    return org


# Aliases for routers that haven't been updated yet
get_current_org_from_jwt = get_default_org
get_current_org_from_api_key = get_default_org
