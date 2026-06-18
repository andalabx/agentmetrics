"""placeholder migration (fills gap between 001 and 003)

Revision ID: 002
Revises: 001
Create Date: 2026-03-27
"""
from collections.abc import Sequence

revision: str = "002"
down_revision: str | None = "001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
