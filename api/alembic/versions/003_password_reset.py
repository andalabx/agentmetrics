"""supabase auth migration

Revision ID: 003
Revises: 002
Create Date: 2026-03-29
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: str | None = "002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop custom auth columns no longer needed
    op.drop_column("organizations", "hashed_password")

    # Add Supabase user ID for JWT-based auth
    op.add_column(
        "organizations",
        sa.Column("supabase_user_id", sa.String(255), nullable=True),
    )
    op.create_index(
        "ix_organizations_supabase_user_id",
        "organizations",
        ["supabase_user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_organizations_supabase_user_id", table_name="organizations")
    op.drop_column("organizations", "supabase_user_id")
    op.add_column(
        "organizations",
        sa.Column("hashed_password", sa.String(255), nullable=False, server_default=""),
    )
