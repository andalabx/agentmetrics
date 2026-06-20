"""Phase 3 observability: new event dimensions, pipeline counters, infra_metrics table

Revision ID: 016
Revises: 015
Create Date: 2026-06-20
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import UUID

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def _col_names(table: str) -> set:
    try:
        return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}
    except Exception:
        return set()


def upgrade() -> None:
    # --- events: new dimension + security columns ---
    events_cols = _col_names("events")
    new_event_cols = [
        ("host_id",               sa.String(255)),
        ("workflow_id",           sa.String(255)),
        ("skill_name",            sa.String(255)),
        ("toolset",               sa.String(100)),
        ("secrets_blocked_count", sa.Integer),
        ("pii_detected_count",    sa.Integer),
    ]
    for col_name, col_type in new_event_cols:
        if col_name not in events_cols:
            op.add_column("events", sa.Column(col_name, col_type, nullable=True))

    try:
        op.execute("CREATE INDEX IF NOT EXISTS ix_events_org_host_id ON events (org_id, host_id) WHERE host_id IS NOT NULL")
    except Exception:
        pass
    try:
        op.execute("CREATE INDEX IF NOT EXISTS ix_events_org_workflow_id ON events (org_id, workflow_id) WHERE workflow_id IS NOT NULL")
    except Exception:
        pass
    try:
        op.execute("CREATE INDEX IF NOT EXISTS ix_events_org_skill_name ON events (org_id, skill_name) WHERE skill_name IS NOT NULL")
    except Exception:
        pass

    # --- metrics_hourly: pipeline counter columns ---
    mh_cols = _col_names("metrics_hourly")
    new_mh_cols = [
        ("duplicate_count",     sa.Integer, sa.text("0")),
        ("wal_recovered_count", sa.Integer, sa.text("0")),
        ("access_denied_count", sa.Integer, sa.text("0")),
        ("dlq_alert_count",     sa.Integer, sa.text("0")),
    ]
    for col_name, col_type, srv_default in new_mh_cols:
        if col_name not in mh_cols:
            op.add_column("metrics_hourly", sa.Column(col_name, col_type, nullable=True, server_default=srv_default))

    # --- infra_metrics table ---
    existing_tables = inspect(op.get_bind()).get_table_names()
    if "infra_metrics" not in existing_tables:
        op.create_table(
            "infra_metrics",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("org_id", sa.Uuid(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("host_id", sa.String(255), nullable=False),
            sa.Column("agent_id", sa.String(255), nullable=True),
            sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("cpu_pct", sa.Float, nullable=True),
            sa.Column("mem_used_mb", sa.Float, nullable=True),
            sa.Column("mem_total_mb", sa.Float, nullable=True),
            sa.Column("disk_used_pct", sa.Float, nullable=True),
            sa.Column("net_rx_kbps", sa.Float, nullable=True),
            sa.Column("net_tx_kbps", sa.Float, nullable=True),
            sa.Column("custom", sa.JSON, nullable=True),
        )
        try:
            op.execute("CREATE INDEX IF NOT EXISTS ix_infra_metrics_org_host_ts ON infra_metrics (org_id, host_id, ts)")
        except Exception:
            pass
        try:
            op.execute("CREATE INDEX IF NOT EXISTS ix_infra_metrics_org_ts ON infra_metrics (org_id, ts)")
        except Exception:
            pass


def downgrade() -> None:
    op.drop_table("infra_metrics")

    for col in ("duplicate_count", "wal_recovered_count", "access_denied_count", "dlq_alert_count"):
        try:
            op.drop_column("metrics_hourly", col)
        except Exception:
            pass

    try:
        op.execute("DROP INDEX IF EXISTS ix_events_org_host_id")
    except Exception:
        pass
    try:
        op.execute("DROP INDEX IF EXISTS ix_events_org_workflow_id")
    except Exception:
        pass
    try:
        op.execute("DROP INDEX IF EXISTS ix_events_org_skill_name")
    except Exception:
        pass

    for col in ("host_id", "workflow_id", "skill_name", "toolset", "secrets_blocked_count", "pii_detected_count"):
        try:
            op.drop_column("events", col)
        except Exception:
            pass
