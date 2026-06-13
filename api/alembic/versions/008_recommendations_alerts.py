"""recommendations (with status) + configurable alerts table

Revision ID: 008
Revises: 007
Create Date: 2026-03-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "008"
down_revision: Union[str, None] = "007"
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

    if "recommendations" not in tables:
        op.create_table(
            "recommendations",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_id", sa.String(255), nullable=True),
            sa.Column("type", sa.String(50), nullable=False),
            sa.Column("priority", sa.String(20), default="medium"),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("estimated_saving_usd", sa.Float, nullable=True),
            sa.Column("status", sa.String(20), default="open"),
            sa.Column("metadata", JSONB, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )
        indexes = _indexes("recommendations")
        if "ix_recommendations_org_status" not in indexes:
            op.create_index("ix_recommendations_org_status", "recommendations", ["org_id", "status"])
        if "ix_recommendations_org_agent" not in indexes:
            op.create_index("ix_recommendations_org_agent", "recommendations", ["org_id", "agent_id"])

    if "alert_rules" not in tables:
        op.create_table(
            "alert_rules",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("agent_id", sa.String(255), nullable=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("metric", sa.String(100), nullable=False),
            sa.Column("operator", sa.String(10), nullable=False),
            sa.Column("threshold", sa.Float, nullable=False),
            sa.Column("window_minutes", sa.Integer, default=60),
            sa.Column("notify_email", sa.Boolean, default=True),
            sa.Column("enabled", sa.Boolean, default=True),
            sa.Column("last_fired_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )
        if "ix_alert_rules_org_enabled" not in _indexes("alert_rules"):
            op.create_index("ix_alert_rules_org_enabled", "alert_rules", ["org_id", "enabled"])

    if "alert_events" not in tables:
        op.create_table(
            "alert_events",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("rule_id", UUID(as_uuid=True), sa.ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False),
            sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("value", sa.Float, nullable=True),
            sa.Column("message", sa.Text, nullable=True),
            sa.Column("notified", sa.Boolean, default=False),
            sa.Column("fired_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )
        indexes = _indexes("alert_events")
        if "ix_alert_events_org" not in indexes:
            op.create_index("ix_alert_events_org", "alert_events", ["org_id"])
        if "ix_alert_events_rule" not in indexes:
            op.create_index("ix_alert_events_rule", "alert_events", ["rule_id"])


def downgrade() -> None:
    op.drop_index("ix_alert_events_rule", table_name="alert_events")
    op.drop_index("ix_alert_events_org", table_name="alert_events")
    op.drop_table("alert_events")
    op.drop_index("ix_alert_rules_org_enabled", table_name="alert_rules")
    op.drop_table("alert_rules")
    op.drop_index("ix_recommendations_org_agent", table_name="recommendations")
    op.drop_index("ix_recommendations_org_status", table_name="recommendations")
    op.drop_table("recommendations")
