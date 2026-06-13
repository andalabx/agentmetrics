"""add settings JSONB column to organizations for agent display names

Revision ID: 009
Revises: 008
Create Date: 2026-04-16
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "009"
down_revision: str | None = "008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    cols = [c["name"] for c in inspect(op.get_bind()).get_columns("organizations")]
    if "settings" not in cols:
        op.add_column("organizations", sa.Column("settings", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "settings")
