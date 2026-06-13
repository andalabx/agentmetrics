"""steps table: per-step tracing within an agent run

Revision ID: 006
Revises: 005
Create Date: 2026-03-31
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "006"
down_revision: str | None = "005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables():
    return inspect(op.get_bind()).get_table_names()

def _indexes(table):
    return [i["name"] for i in inspect(op.get_bind()).get_indexes(table)]


def upgrade() -> None:
    if "steps" not in _tables():
        op.create_table(
            "steps",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("event_id", UUID(as_uuid=True), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
            sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("trace_id", sa.String(255), nullable=False),
            sa.Column("step_name", sa.String(255), nullable=False),
            sa.Column("step_type", sa.String(50), nullable=True),
            sa.Column("status", sa.String(50), nullable=False),
            sa.Column("duration_ms", sa.Float, nullable=True),
            sa.Column("model", sa.String(100), nullable=True),
            sa.Column("input_tokens", sa.Integer, nullable=True),
            sa.Column("output_tokens", sa.Integer, nullable=True),
            sa.Column("cost_usd", sa.Float, default=0.0),
            sa.Column("error_message", sa.Text, nullable=True),
            sa.Column("metadata", JSONB, nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )
        indexes = _indexes("steps")
        if "ix_steps_event_id" not in indexes:
            op.create_index("ix_steps_event_id", "steps", ["event_id"])
        if "ix_steps_org_trace" not in indexes:
            op.create_index("ix_steps_org_trace", "steps", ["org_id", "trace_id"])


def downgrade() -> None:
    op.drop_index("ix_steps_org_trace", table_name="steps")
    op.drop_index("ix_steps_event_id", table_name="steps")
    op.drop_table("steps")
