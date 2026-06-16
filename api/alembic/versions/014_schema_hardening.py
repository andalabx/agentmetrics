"""schema hardening: status check, drop password_hash, add sdk_version

Revision ID: 014_schema_hardening
Revises: 013
Create Date: 2026-06-16

"""
import sqlalchemy as sa
from alembic import op

revision = "014_schema_hardening"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add sdk_version column to events
    op.add_column("events", sa.Column("sdk_version", sa.String(32), nullable=True))

    # Drop the dead password_hash column from organizations
    with op.batch_alter_table("organizations") as batch_op:
        batch_op.drop_column("password_hash")

    # Add CHECK constraint on events.status (PostgreSQL only; SQLite ignores CHECK)
    # Use try/except since SQLite won't support this
    try:
        op.execute("""
            ALTER TABLE events
            ADD CONSTRAINT ck_events_status
            CHECK (status IN ('completed','failed','running','cancelled','timeout','killed','success'))
        """)
    except Exception:
        pass  # SQLite does not enforce CHECK constraints


def downgrade() -> None:
    try:
        op.execute("ALTER TABLE events DROP CONSTRAINT ck_events_status")
    except Exception:
        pass
    op.add_column("organizations", sa.Column("password_hash", sa.String, nullable=True))
    op.drop_column("events", "sdk_version")
