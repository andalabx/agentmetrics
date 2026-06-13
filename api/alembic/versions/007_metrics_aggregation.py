"""hourly metrics aggregation table

Revision ID: 007
Revises: 006
Create Date: 2026-03-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables():
    return inspect(op.get_bind()).get_table_names()

def _indexes(table):
    try:
        return [i["name"] for i in inspect(op.get_bind()).get_indexes(table)]
    except Exception:
        return []


def upgrade() -> None:
    tables = _tables()

    if "metrics_hourly" not in tables:
        op.create_table(
            "metrics_hourly",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_id", sa.String(255), nullable=False),
            sa.Column("hour", sa.DateTime(timezone=True), nullable=False),
            sa.Column("run_count", sa.Integer, default=0),
            sa.Column("success_count", sa.Integer, default=0),
            sa.Column("failure_count", sa.Integer, default=0),
            sa.Column("avg_duration_ms", sa.Float, nullable=True),
            sa.Column("p50_duration_ms", sa.Float, nullable=True),
            sa.Column("p95_duration_ms", sa.Float, nullable=True),
            sa.Column("p99_duration_ms", sa.Float, nullable=True),
            sa.Column("total_cost_usd", sa.Float, default=0.0),
            sa.Column("total_input_tokens", sa.BigInteger, default=0),
            sa.Column("total_output_tokens", sa.BigInteger, default=0),
            sa.Column("cost_by_model", JSONB, nullable=True),
            sa.Column("error_rate", sa.Float, nullable=True),
            sa.Column("loop_count", sa.Integer, default=0),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )
        indexes = _indexes("metrics_hourly")
        if "ix_metrics_hourly_org_agent_hour" not in indexes:
            op.create_index("ix_metrics_hourly_org_agent_hour", "metrics_hourly", ["org_id", "agent_id", "hour"], unique=True)
        if "ix_metrics_hourly_org_hour" not in indexes:
            op.create_index("ix_metrics_hourly_org_hour", "metrics_hourly", ["org_id", "hour"])

    if "monthly_usage" not in tables:
        op.create_table(
            "monthly_usage",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("year_month", sa.String(7), nullable=False),
            sa.Column("event_count", sa.Integer, default=0),
            sa.Column("total_cost_usd", sa.Float, default=0.0),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )
        if "ix_monthly_usage_org_month" not in _indexes("monthly_usage"):
            op.create_index("ix_monthly_usage_org_month", "monthly_usage", ["org_id", "year_month"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_monthly_usage_org_month", table_name="monthly_usage")
    op.drop_table("monthly_usage")
    op.drop_index("ix_metrics_hourly_org_hour", table_name="metrics_hourly")
    op.drop_index("ix_metrics_hourly_org_agent_hour", table_name="metrics_hourly")
    op.drop_table("metrics_hourly")
