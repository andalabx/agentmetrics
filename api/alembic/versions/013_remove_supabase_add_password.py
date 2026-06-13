"""Replace supabase_user_id with password_hash on organizations

Revision ID: 013
Revises: 012
Create Date: 2026-06-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _col_names(table: str) -> set:
    try:
        return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}
    except Exception:
        return set()


def upgrade() -> None:
    cols = _col_names("organizations")

    if "supabase_user_id" in cols:
        op.drop_index("ix_organizations_supabase_user_id", table_name="organizations", if_exists=True)
        op.drop_column("organizations", "supabase_user_id")

    if "password_hash" not in cols:
        op.add_column("organizations", sa.Column("password_hash", sa.String(255), nullable=True))


def downgrade() -> None:
    cols = _col_names("organizations")

    if "password_hash" in cols:
        op.drop_column("organizations", "password_hash")

    if "supabase_user_id" not in cols:
        op.add_column("organizations", sa.Column("supabase_user_id", sa.String(255), nullable=True))
        op.create_index("ix_organizations_supabase_user_id", "organizations", ["supabase_user_id"], unique=True)
