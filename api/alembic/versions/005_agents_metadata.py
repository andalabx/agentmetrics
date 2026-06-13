"""agents table + metadata JSONB on events

Revision ID: 005
Revises: 004
Create Date: 2026-03-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables():
    return inspect(op.get_bind()).get_table_names()

def _columns(table):
    return [c["name"] for c in inspect(op.get_bind()).get_columns(table)]

def _indexes(table):
    return [i["name"] for i in inspect(op.get_bind()).get_indexes(table)]


def upgrade() -> None:
    tables = _tables()

    if "agents" not in tables:
        op.create_table(
            "agents",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_id", sa.String(255), nullable=False),
            sa.Column("display_name", sa.String(255), nullable=True),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("environment", sa.String(50), nullable=True),
            sa.Column("tags", JSONB, nullable=True),
            sa.Column("first_seen", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )
        if "ix_agents_org_agent" not in _indexes("agents"):
            op.create_index("ix_agents_org_agent", "agents", ["org_id", "agent_id"], unique=True)

    existing_cols = _columns("events")
    for col, typ in [
        ("metadata",    JSONB),
        ("step_count",  sa.Integer),
        ("tool_calls",  sa.Integer),
        ("environment", sa.String(50)),
        ("version",     sa.String(50)),
    ]:
        if col not in existing_cols:
            op.add_column("events", sa.Column(col, typ, nullable=True))


def downgrade() -> None:
    for col in ("version", "environment", "tool_calls", "step_count", "metadata"):
        op.drop_column("events", col)
    op.drop_index("ix_agents_org_agent", table_name="agents")
    op.drop_table("agents")
