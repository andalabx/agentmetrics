"""Add performance indexes for hot query paths

Revision ID: 011
Revises: 010
Create Date: 2026-05-24
"""
from alembic import op

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_org_ts ON events (org_id, timestamp DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_org_status ON events (org_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_org_agent_status ON events (org_id, agent_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_org_model ON events (org_id, model) WHERE model IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_events_org_ts")
    op.execute("DROP INDEX IF EXISTS ix_events_org_status")
    op.execute("DROP INDEX IF EXISTS ix_events_org_agent_status")
    op.execute("DROP INDEX IF EXISTS ix_events_org_model")
