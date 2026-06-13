import uuid
from sqlalchemy import (
    Column, String, Float, Integer, BigInteger, DateTime, JSON,
    ForeignKey, Index, UniqueConstraint, Uuid, func,
)
from app.database import Base


class MetricsHourly(Base):
    """
    One row per (org, agent, UTC hour). Written by the hourly aggregation job.
    Uses generic SQLAlchemy types so create_all() works on SQLite.
    PostgreSQL uses the Alembic migration (007); this model is for SQLite only.
    """
    __tablename__ = "metrics_hourly"

    id          = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id      = Column(Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    agent_id    = Column(String(255), nullable=False)
    hour        = Column(DateTime(timezone=True), nullable=False)

    run_count     = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    failure_count = Column(Integer, default=0)

    avg_duration_ms = Column(Float, nullable=True)
    p50_duration_ms = Column(Float, nullable=True)
    p95_duration_ms = Column(Float, nullable=True)
    p99_duration_ms = Column(Float, nullable=True)

    total_cost_usd       = Column(Float, default=0.0)
    total_input_tokens   = Column(BigInteger, default=0)
    total_output_tokens  = Column(BigInteger, default=0)
    cost_by_model        = Column(JSON, nullable=True)

    error_rate  = Column(Float, nullable=True)
    loop_count  = Column(Integer, default=0)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("org_id", "agent_id", "hour", name="ix_metrics_hourly_org_agent_hour"),
        Index("ix_metrics_hourly_org_hour", "org_id", "hour"),
    )


class MonthlyUsage(Base):
    """
    One row per (org, YYYY-MM). Written by the daily aggregation job.
    """
    __tablename__ = "monthly_usage"

    id             = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id         = Column(Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    year_month     = Column(String(7), nullable=False)   # e.g. "2024-01"
    event_count    = Column(Integer, default=0)
    total_cost_usd = Column(Float, default=0.0)
    updated_at     = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("org_id", "year_month", name="ix_monthly_usage_org_month"),
    )
