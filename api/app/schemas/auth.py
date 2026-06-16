from pydantic import BaseModel, constr

_Name = constr(min_length=1, max_length=255, strip_whitespace=True)


class OrgResponse(BaseModel):
    id: str
    email: str
    company_name: str
    plan: str
    slack_webhook: str | None = None


class UpdateOrgRequest(BaseModel):
    company_name: _Name | None = None
    slack_webhook: str | None = None


class RotateKeyResponse(BaseModel):
    api_key: str  # raw key — shown once, store immediately
