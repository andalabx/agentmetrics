from typing import Optional
from pydantic import BaseModel, constr

_Name = constr(min_length=1, max_length=255, strip_whitespace=True)


class OrgResponse(BaseModel):
    id: str
    email: str
    company_name: str
    plan: str
    slack_webhook: Optional[str] = None


class UpdateOrgRequest(BaseModel):
    company_name: Optional[_Name] = None
    slack_webhook: Optional[str] = None
