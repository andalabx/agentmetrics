import uuid
from sqlalchemy import Column, String, Float, Integer, DateTime, Text, Index, Uuid, JSON, ForeignKey, func
from app.database import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    trace_id = Column(String(255), nullable=False)
    agent_id = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False)  # "success" | "failed"
    duration_ms = Column(Float, nullable=True)
    cost_usd = Column(Float, default=0.0)
    model = Column(String(100), nullable=True)
    input_tokens = Column(Float, nullable=True)
    output_tokens = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    # Added in migration 005, renamed metadata→run_metadata in migration 012
    run_metadata = Column(JSON, nullable=True)
    step_count = Column(Integer, nullable=True)
    tool_calls = Column(Integer, nullable=True)
    environment = Column(String(50), nullable=True)
    version = Column(String(50), nullable=True)
    # Promoted from JSONB in migration 012 (v2 schema)
    cache_read_tokens = Column(Float, nullable=True)
    cache_write_tokens = Column(Float, nullable=True)
    total_tokens = Column(Float, nullable=True)
    tool_errors = Column(Integer, nullable=True)
    llm_calls = Column(Integer, nullable=True)
    images_count = Column(Integer, nullable=True)
    subagents_spawned = Column(Integer, nullable=True)
    subagent_errors = Column(Integer, nullable=True)
    compactions = Column(Integer, nullable=True)
    resets = Column(Integer, nullable=True)
    loop_count = Column(Integer, nullable=True)

    __table_args__ = (
        Index("ix_events_org_agent_ts", "org_id", "agent_id", "timestamp"),
        Index("ix_events_org_id", "org_id"),
    )
