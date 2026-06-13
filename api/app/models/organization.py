import uuid
from sqlalchemy import Column, String, DateTime, Uuid, JSON, func
from app.database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)
    company_name = Column(String(255), nullable=False)
    plan = Column(String(50), default="free", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Org-level settings - stores agent display names, UI prefs, etc.
    # Shape: { "agent_names": { "<agent_id>": "<display_name>" } }
    settings = Column(JSON, nullable=True)
