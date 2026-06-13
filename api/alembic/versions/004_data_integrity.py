"""data integrity: FK on events, indexes, token type fix

Revision ID: 004
Revises: 003
Create Date: 2026-03-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add FK from events.org_id → organizations.id with cascade delete
    op.create_foreign_key(
        "fk_events_org_id",
        "events",
        "organizations",
        ["org_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Add standalone index on events.org_id for fast per-org queries
    op.create_index("ix_events_org_id", "events", ["org_id"])


def downgrade() -> None:
    op.drop_index("ix_events_org_id", table_name="events")
    op.drop_constraint("fk_events_org_id", "events", type_="foreignkey")
