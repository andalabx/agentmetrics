import logging
import uuid

from sqlalchemy import text

logger = logging.getLogger("agentmetrics")

_DEFAULT_ALERT_RULES = [
    {
        "name": "High error rate",
        "metric": "error_rate",
        "operator": "gt",
        "threshold": 0.10,
        "window_minutes": 60,
    },
    {
        "name": "Critical error rate",
        "metric": "error_rate",
        "operator": "gt",
        "threshold": 0.50,
        "window_minutes": 30,
    },
    {
        "name": "Cost spike",
        "metric": "cost_usd",
        "operator": "gt",
        "threshold": 5.00,
        "window_minutes": 60,
    },
    {
        "name": "Cost runaway",
        "metric": "cost_usd",
        "operator": "gt",
        "threshold": 25.00,
        "window_minutes": 60,
    },
    {
        "name": "High latency",
        "metric": "duration_ms",
        "operator": "gt",
        "threshold": 30000,
        "window_minutes": 60,
    },
    {
        "name": "Critical latency",
        "metric": "duration_ms",
        "operator": "gt",
        "threshold": 60000,
        "window_minutes": 30,
    },
    {
        "name": "Run volume spike",
        "metric": "run_count",
        "operator": "gt",
        "threshold": 500,
        "window_minutes": 60,
    },
    {
        "name": "Excessive retries",
        "metric": "loop_count",
        "operator": "gt",
        "threshold": 100,
        "window_minutes": 60,
    },
]


def _provision_default_alert_rules(org_id: str, db) -> None:
    """Insert any missing default alert rules for an org (one per metric)."""
    try:
        existing_names = {
            row[0] for row in db.execute(
                text("SELECT name FROM alert_rules WHERE org_id = :org_id"),
                {"org_id": org_id},
            ).fetchall()
        }
        missing = [r for r in _DEFAULT_ALERT_RULES if r["name"] not in existing_names]
        if not missing:
            return
        for rule in missing:
            db.execute(text("""
                INSERT INTO alert_rules
                    (id, org_id, agent_id, name, metric, operator, threshold, window_minutes, notify_email, enabled)
                VALUES
                    (:id, :org_id, NULL, :name, :metric, :operator, :threshold, :window_minutes, true, true)
            """), {
                "id": str(uuid.uuid4()),
                "org_id": org_id,
                "name": rule["name"],
                "metric": rule["metric"],
                "operator": rule["operator"],
                "threshold": rule["threshold"],
                "window_minutes": rule["window_minutes"],
            })
        db.commit()
        logger.info("Provisioned %d missing default alert rules for org %s", len(missing), org_id)
    except Exception as exc:
        db.rollback()
        logger.warning("Could not provision default alert rules for org %s: %s", org_id, exc)
