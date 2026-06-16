"""Add sdk_key_hash for API key authentication

Revision ID: 015
Revises: 014_schema_hardening
Create Date: 2026-06-16

Adds sdk_key_hash (sha256 of the raw API key) to organizations.
The raw key is never stored — it is printed once at first run.
"""
import sqlalchemy as sa
from alembic import op

revision = "015"
down_revision = "014_schema_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("sdk_key_hash", sa.String(64), nullable=True, index=True),
    )


def downgrade() -> None:
    op.drop_column("organizations", "sdk_key_hash")
