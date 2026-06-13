"""v2 schema: rename metadata→run_metadata, promote JSONB fields to columns

Revision ID: 012
Revises: 011
Create Date: 2026-06-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _col_names(table: str) -> set:
    try:
        return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}
    except Exception:
        return set()


def upgrade() -> None:
    cols = _col_names("events")

    # Rename metadata → run_metadata (all raw SQL and v2 code uses run_metadata)
    if "metadata" in cols and "run_metadata" not in cols:
        op.alter_column("events", "metadata", new_column_name="run_metadata")

    # Promote frequently-queried JSONB fields to first-class columns
    new_cols = [
        ("cache_read_tokens",  sa.Float),
        ("cache_write_tokens", sa.Float),
        ("total_tokens",       sa.Float),
        ("tool_errors",        sa.Integer),
        ("llm_calls",          sa.Integer),
        ("images_count",       sa.Integer),
        ("subagents_spawned",  sa.Integer),
        ("subagent_errors",    sa.Integer),
        ("compactions",        sa.Integer),
        ("resets",             sa.Integer),
        ("loop_count",         sa.Integer),
    ]
    cols_after = _col_names("events")
    for col_name, col_type in new_cols:
        if col_name not in cols_after:
            op.add_column("events", sa.Column(col_name, col_type, nullable=True))

    # Index cache tokens alongside input/output for cost queries
    try:
        op.execute("CREATE INDEX IF NOT EXISTS ix_events_org_agent_model_ts ON events (org_id, agent_id, model, timestamp DESC) WHERE model IS NOT NULL")
    except Exception:
        pass


def downgrade() -> None:
    for col in (
        "cache_read_tokens", "cache_write_tokens", "total_tokens",
        "tool_errors", "llm_calls", "images_count",
        "subagents_spawned", "subagent_errors", "compactions", "resets", "loop_count",
    ):
        op.drop_column("events", col)

    op.execute(text("DROP INDEX IF EXISTS ix_events_org_agent_model_ts"))
    op.alter_column("events", "run_metadata", new_column_name="metadata")
