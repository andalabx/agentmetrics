"""
Alert rule evaluation service.
Reads enabled alert_rules, checks metrics_hourly data,
fires alert_events when thresholds are crossed.
"""
import logging
import time
from threading import Lock

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_ALLOWED_SLACK_PREFIXES = ("https://hooks.slack.com/", "https://hooks.slack-gov.com/")


def _is_safe_webhook(url: str) -> bool:
    return any(url.startswith(p) for p in _ALLOWED_SLACK_PREFIXES)


# NOTE: Per-process in-memory debounce. In multi-replica deployments each replica
# maintains independent state — alerts may fire N times per threshold breach.
# Replace with a Redis-backed counter for multi-replica setups.
_last_realtime_eval: dict[str, float] = {}
_debounce_lock = Lock()
_DEBOUNCE_SECONDS = 60  # 1 minute

# Map frontend metric names → metrics_hourly column names (migration 007)
_METRIC_COLUMN = {
    "error_rate":   "error_rate",       # 0.0-1.0 fraction
    "cost_usd":     "total_cost_usd",   # total cost in window
    "duration_ms":  "p95_duration_ms",  # p95 latency as proxy for "duration"
    "loop_count":   "loop_count",
    "run_count":    "run_count",
    # legacy names kept for backward compat
    "p95_latency":  "p95_duration_ms",
    "p99_latency":  "p99_duration_ms",
    "total_cost":   "total_cost_usd",
}

# Both storage forms ("gt") and symbol forms (">") are accepted
_OP_NORMALIZE = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


def _check_threshold(op: str, actual: float, threshold: float) -> bool:
    op = _OP_NORMALIZE.get(op, op)
    if op == ">":
        return actual > threshold
    if op == ">=":
        return actual >= threshold
    if op == "<":
        return actual < threshold
    if op == "<=":
        return actual <= threshold
    if op == "==":
        return actual == threshold
    return False


def evaluate_alerts(db: Session) -> None:
    """
    Evaluate all enabled alert rules against recent metrics_hourly data.
    Falls back to querying raw events directly when metrics_hourly has no data.
    """
    try:
        rules = _load_rules(db)
        if not rules:
            return

        for rule in rules:
            try:
                _evaluate_rule(db, rule)
            except Exception as exc:
                logger.error("[alerts] Rule %s failed: %s", rule["id"], exc, exc_info=True)

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("[alerts] evaluate_alerts failed: %s", exc, exc_info=True)


def _load_rules(db: Session) -> list[dict]:
    try:
        rows = db.execute(text("""
            SELECT r.id, r.org_id, r.agent_id, r.metric, r.operator, r.threshold,
                   r.window_minutes, r.notify_email, o.email AS org_email,
                   o.company_name, o.settings AS org_settings, r.name
            FROM alert_rules r
            JOIN organizations o ON o.id = r.org_id
            WHERE r.enabled = true
        """)).fetchall()
        rules = []
        for row in rows:
            d = dict(row._mapping)
            settings = d.pop("org_settings", None) or {}
            d["slack_webhook"] = settings.get("slack_webhook")
            rules.append(d)
        return rules
    except Exception as exc:
        if "alert_rules" in str(exc).lower():
            return []
        raise


def _evaluate_rule(db: Session, rule: dict) -> None:
    metric_col = _METRIC_COLUMN.get(rule["metric"])
    if not metric_col:
        logger.debug("[alerts] Unknown metric '%s' for rule %s, skipping", rule["metric"], rule["id"])
        return

    window_hours = max(1, (rule["window_minutes"] or 60) // 60)
    params: dict = {"org_id": str(rule["org_id"]), "window_hours": window_hours, "agent_id": rule.get("agent_id")}

    # Try metrics_hourly first
    actual_value = _query_metrics_hourly(db, metric_col, params, window_hours)

    # Fall back to raw events if metrics_hourly is empty
    if actual_value is None and rule["metric"] in ("error_rate", "cost_usd", "run_count", "loop_count"):
        actual_value = _query_events_fallback(db, rule["metric"], params, window_hours)

    if actual_value is None:
        return

    threshold = float(rule["threshold"])
    if not _check_threshold(rule["operator"], actual_value, threshold):
        return

    # Dedup: don't re-fire within the same window
    already_fired = db.execute(text("""
        SELECT id FROM alert_events
        WHERE rule_id = :rule_id
          AND fired_at >= now() - (:window_hours * INTERVAL '1 hour')
        LIMIT 1
    """), {"rule_id": str(rule["id"]), "window_hours": window_hours}).fetchone()

    if already_fired:
        return

    db.execute(text("""
        INSERT INTO alert_events (rule_id, org_id, value, notified, fired_at)
        VALUES (:rule_id, :org_id, :value, false, now())
    """), {"rule_id": str(rule["id"]), "org_id": str(rule["org_id"]), "value": float(actual_value)})

    # Flush so the row exists before we try to update notified
    db.flush()

    logger.info(
        "[alerts] Rule '%s' fired: %s %s %s (actual=%.4f)",
        rule.get("name", rule["id"]), rule["metric"], rule["operator"], threshold, actual_value,
    )

    sent = _send_alert_notification(rule=rule, actual_value=actual_value, threshold=threshold)

    # Only mark notified if email actually succeeded
    if sent:
        db.execute(text("""
            UPDATE alert_events SET notified = true
            WHERE rule_id = :rule_id AND fired_at >= now() - INTERVAL '1 minute'
        """), {"rule_id": str(rule["id"])})


def _query_metrics_hourly(
    db: Session, metric_col: str, params: dict, window_hours: int
) -> float | None:
    # metric_col comes from _METRIC_COLUMN lookup (hardcoded dict) - safe to interpolate.
    # agent_filter is either "" or the hardcoded string "AND agent_id = :agent_id" - safe.
    # All user-supplied values travel through named bind params only.
    try:
        row = db.execute(text(f"""
            SELECT {metric_col}
            FROM metrics_hourly
            WHERE org_id = :org_id
              AND (:agent_id_filter IS NULL OR agent_id = :agent_id_filter)
              AND hour >= now() - (:window_hours * INTERVAL '1 hour')
            ORDER BY hour DESC
            LIMIT 1
        """), {**params, "agent_id_filter": params.get("agent_id")}).fetchone()
        return float(row[0]) if row and row[0] is not None else None
    except Exception as exc:
        if "does not exist" in str(exc).lower():
            return None
        raise


def _query_events_fallback(
    db: Session, metric: str, params: dict, window_hours: int
) -> float | None:
    """Direct query on raw events - used when metrics_hourly has no data yet."""
    agent_id_filter = params.get("agent_id")
    base_params = {**params, "agent_id_filter": agent_id_filter}
    try:
        _nsm = "AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')"
        if metric == "error_rate":
            row = db.execute(text(f"""
                SELECT AVG(CASE WHEN status = 'failed' THEN 1.0 ELSE 0.0 END)
                FROM events
                WHERE org_id = :org_id
                  AND (:agent_id_filter IS NULL OR agent_id = :agent_id_filter)
                  AND timestamp >= now() - (:window_hours * INTERVAL '1 hour')
                  {_nsm}
            """), base_params).fetchone()
        elif metric == "cost_usd":
            row = db.execute(text(f"""
                SELECT SUM(cost_usd)
                FROM events
                WHERE org_id = :org_id
                  AND (:agent_id_filter IS NULL OR agent_id = :agent_id_filter)
                  AND timestamp >= now() - (:window_hours * INTERVAL '1 hour')
                  {_nsm}
            """), base_params).fetchone()
        elif metric == "run_count":
            row = db.execute(text(f"""
                SELECT COUNT(*)
                FROM events
                WHERE org_id = :org_id
                  AND (:agent_id_filter IS NULL OR agent_id = :agent_id_filter)
                  AND timestamp >= now() - (:window_hours * INTERVAL '1 hour')
                  {_nsm}
            """), base_params).fetchone()
        elif metric == "loop_count":
            row = db.execute(text(f"""
                SELECT SUM(loop_count)
                FROM events
                WHERE org_id = :org_id
                  AND (:agent_id_filter IS NULL OR agent_id = :agent_id_filter)
                  AND timestamp >= now() - (:window_hours * INTERVAL '1 hour')
                  {_nsm}
            """), base_params).fetchone()
        else:
            return None
        return float(row[0]) if row and row[0] is not None else None
    except Exception:
        return None


def _send_alert_notification(rule: dict, actual_value: float, threshold: float) -> bool:
    """Send Slack notification if a webhook is configured."""
    webhook_url = rule.get("slack_webhook") or rule.get("org_settings", {}).get("slack_webhook", "")
    if not webhook_url:
        return False
    if _is_safe_webhook(webhook_url):
        from app.services.email_service import send_slack_notification
        return send_slack_notification(
            webhook_url=webhook_url,
            rule=rule, actual_value=actual_value, threshold=threshold,
        )
    else:
        logger.warning(
            "[alerts] Rejected webhook URL that does not match allowed Slack prefixes "
            "(SSRF guard): %.80s", webhook_url,
        )
        return False


def evaluate_alerts_for_org(org_id: str, db: Session) -> None:
    """
    Real-time alert evaluation triggered on event ingestion.
    Uses raw events directly (metrics_hourly isn't updated yet).
    Debounced to at most once per 5 minutes per org to avoid evaluation on every event.
    """
    now = time.monotonic()
    with _debounce_lock:
        last = _last_realtime_eval.get(org_id, 0)
        if now - last < _DEBOUNCE_SECONDS:
            return
        _last_realtime_eval[org_id] = now

    try:
        # Load rules for this org only
        rows = db.execute(text("""
            SELECT r.id, r.org_id, r.agent_id, r.metric, r.operator, r.threshold,
                   r.window_minutes, r.notify_email, o.email AS org_email,
                   o.company_name, r.name, o.settings AS org_settings
            FROM alert_rules r
            JOIN organizations o ON o.id = r.org_id
            WHERE r.enabled = true AND r.org_id = :org_id
        """), {"org_id": org_id}).fetchall()

        if not rows:
            return

        rules = []
        for row in rows:
            d = dict(row._mapping)
            settings = d.pop("org_settings", None) or {}
            d["slack_webhook"] = settings.get("slack_webhook")
            rules.append(d)
        for rule in rules:
            try:
                _evaluate_rule_realtime(db, rule)
            except Exception as exc:
                logger.error("[alerts:realtime] Rule %s failed: %s", rule["id"], exc)

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("[alerts:realtime] evaluate_alerts_for_org failed for %s: %s", org_id, exc)


def _evaluate_rule_realtime(db: Session, rule: dict) -> None:
    """Evaluate a single rule using raw events only (no metrics_hourly)."""
    metric = rule["metric"]
    if rule["operator"] not in _OP_NORMALIZE:
        return

    window_hours = max(1, (rule["window_minutes"] or 60) // 60)
    params: dict = {"org_id": str(rule["org_id"]), "window_hours": window_hours, "agent_id": rule.get("agent_id")}

    actual_value = _query_events_fallback(db, metric, params, window_hours)
    if actual_value is None:
        return

    threshold = float(rule["threshold"])
    if not _check_threshold(rule["operator"], actual_value, threshold):
        return

    # Dedup: don't re-fire within the window
    already_fired = db.execute(text("""
        SELECT id FROM alert_events
        WHERE rule_id = :rule_id
          AND fired_at >= now() - (:window_hours * INTERVAL '1 hour')
        LIMIT 1
    """), {"rule_id": str(rule["id"]), "window_hours": window_hours}).fetchone()

    if already_fired:
        return

    db.execute(text("""
        INSERT INTO alert_events (rule_id, org_id, value, notified, fired_at)
        VALUES (:rule_id, :org_id, :value, false, now())
    """), {"rule_id": str(rule["id"]), "org_id": str(rule["org_id"]), "value": float(actual_value)})

    db.flush()
    logger.info("[alerts:realtime] Rule '%s' fired: %s %s %s (actual=%.4f)",
        rule.get("name", rule["id"]), metric, rule["operator"], threshold, actual_value)

    sent = _send_alert_notification(rule=rule, actual_value=actual_value, threshold=threshold)
    if sent:
        db.execute(text("""
            UPDATE alert_events SET notified = true
            WHERE rule_id = :rule_id AND fired_at >= now() - INTERVAL '1 minute'
        """), {"rule_id": str(rule["id"])})
