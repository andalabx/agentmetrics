"""Schema fixes: FK constraints, monthly_usage total_cost_usd, plan index

Revision ID: 010
Revises: 009
Create Date: 2026-05-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _col_names(table: str) -> set:
    try:
        return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}
    except Exception:
        return set()


def _fk_names(table: str) -> set:
    try:
        return {fk["name"] for fk in inspect(op.get_bind()).get_foreign_keys(table)}
    except Exception:
        return set()


def _index_names(table: str) -> set:
    try:
        return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}
    except Exception:
        return set()


def upgrade() -> None:
    fks = _fk_names("subscriptions")
    if "fk_subscriptions_org_id" not in fks:
        op.execute(text("""
            ALTER TABLE subscriptions
            ADD CONSTRAINT fk_subscriptions_org_id
            FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
        """))

    fks = _fk_names("monthly_usage")
    if "fk_monthly_usage_org_id" not in fks:
        op.execute(text("""
            ALTER TABLE monthly_usage
            ADD CONSTRAINT fk_monthly_usage_org_id
            FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
        """))

    cols = _col_names("monthly_usage")
    if "total_cost_usd" not in cols:
        op.add_column("monthly_usage", sa.Column("total_cost_usd", sa.Float, server_default="0"))

    indexes = _index_names("organizations")
    if "ix_organizations_plan" not in indexes:
        op.create_index("ix_organizations_plan", "organizations", ["plan"])


def downgrade() -> None:
    op.execute(text("ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS fk_subscriptions_org_id"))
    op.execute(text("ALTER TABLE monthly_usage DROP CONSTRAINT IF EXISTS fk_monthly_usage_org_id"))
    op.execute(text("ALTER TABLE monthly_usage DROP COLUMN IF EXISTS total_cost_usd"))
    op.drop_index("ix_organizations_plan", table_name="organizations")
