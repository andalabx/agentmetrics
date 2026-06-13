"""
Alert notification service.
Supports Slack webhook notifications. Email alert delivery is not included.
"""
import logging
from datetime import UTC, datetime

logger = logging.getLogger(__name__)

_METRIC_LABELS = {
    "error_rate":   ("Error rate",       lambda v: f"{v * 100:.1f}%"),
    "cost_usd":     ("Cost",             lambda v: f"${v:.4f}"),
    "duration_ms":  ("p95 Latency",      lambda v: f"{v:,.0f} ms"),
    "run_count":    ("Run count",        lambda v: f"{int(v):,}"),
    "p95_latency":  ("p95 Latency",      lambda v: f"{v:,.0f} ms"),
    "p99_latency":  ("p99 Latency",      lambda v: f"{v:,.0f} ms"),
    "total_cost":   ("Cost",             lambda v: f"${v:.4f}"),
}

_OP_LABELS = {
    "gt":  ">",   "gte": ">=",  "lt":  "<",  "lte": "<=",
    ">":   ">",   ">=":  ">=",  "<":   "<",  "<=":  "<=",  "==": "=",
}


def _format_value(metric: str, value: float) -> str:
    entry = _METRIC_LABELS.get(metric)
    return entry[1](value) if entry else f"{value:.4f}"


def _metric_label(metric: str) -> str:
    entry = _METRIC_LABELS.get(metric)
    return entry[0] if entry else metric.replace("_", " ").title()


def _build_html(rule: dict, actual_value: float, threshold: float, app_url: str) -> str:
    metric_lbl    = _metric_label(rule["metric"])
    actual_str    = _format_value(rule["metric"], actual_value)
    threshold_str = _format_value(rule["metric"], threshold)
    op_str        = _OP_LABELS.get(rule["operator"], rule["operator"])
    agent_label   = rule.get("agent_id") or "all agents"
    rule_name     = rule.get("name") or f"{metric_lbl} alert"
    company       = rule.get("company_name") or "your organization"
    now_str       = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    agent_url     = f"{app_url}/agents/{rule['agent_id']}" if rule.get("agent_id") else f"{app_url}/agents"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Alert: {rule_name}</title>
</head>
<body style="margin:0;padding:0;background:#0A1510;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1510;padding:48px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Wordmark -->
          <tr>
            <td style="padding-bottom:28px;">
              <p style="margin:0;font-size:12px;font-weight:800;letter-spacing:0.22em;text-transform:uppercase;color:#00D4A8;">
                AgentMetrics
              </p>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#0D1F19;border:1px solid rgba(0,212,168,0.12);border-radius:24px;padding:36px 32px;">

              <!-- Alert badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
                <tr>
                  <td style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:999px;padding:4px 14px;">
                    <span style="font-size:10px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#F87171;">
                      &#9888;&nbsp; Alert triggered
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Title -->
              <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#F1F5F9;letter-spacing:-0.025em;line-height:1.2;">
                {rule_name}
              </h1>
              <p style="margin:0 0 28px;font-size:13px;color:#64748B;">
                {company}&ensp;&middot;&ensp;{now_str}
              </p>

              <!-- Value tile -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border-radius:16px;overflow:hidden;">
                <tr>
                  <td style="background:#0A0F0E;border:1px solid rgba(239,68,68,0.2);border-radius:16px;padding:22px 24px;">
                    <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#64748B;">
                      {metric_lbl} &mdash; {agent_label}
                    </p>
                    <p style="margin:0;font-size:40px;font-weight:800;color:#F87171;letter-spacing:-0.04em;font-variant-numeric:tabular-nums;line-height:1;">
                      {actual_str}
                    </p>
                    <table cellpadding="0" cellspacing="0" style="margin-top:10px;">
                      <tr>
                        <td style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:4px 10px;">
                          <span style="font-size:11px;color:#94A3B8;">Threshold: {op_str} {threshold_str}</span>
                        </td>
                        <td style="padding-left:8px;">
                          <span style="font-size:11px;color:#64748B;">Window: {rule.get('window_minutes', 60)} min</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#00D4A8;border-radius:12px;">
                    <a href="{agent_url}"
                       style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#050C0A;text-decoration:none;letter-spacing:-0.01em;">
                      View in dashboard &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:28px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#374151;line-height:1.8;">
                You have an active alert rule in AgentMetrics.<br>
                <a href="{app_url}/alerts" style="color:#00D4A8;text-decoration:none;">Manage alert rules</a>
                &nbsp;&middot;&nbsp;
                <a href="{app_url}/agents" style="color:#4B5563;text-decoration:none;">View all agents</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


_ALLOWED_SLACK_PREFIXES = (
    "https://hooks.slack.com/",
    "https://hooks.slack-gov.com/",
)


def send_slack_notification(webhook_url: str, rule: dict, actual_value: float, threshold: float) -> bool:
    """POST an alert message to a Slack incoming webhook URL."""
    if not webhook_url:
        return False
    if not any(webhook_url.startswith(p) for p in _ALLOWED_SLACK_PREFIXES):
        logger.warning("[slack] Rejected non-Slack webhook URL (SSRF guard)")
        return False
    try:
        import httpx
        metric_lbl    = _metric_label(rule["metric"])
        actual_str    = _format_value(rule["metric"], actual_value)
        threshold_str = _format_value(rule["metric"], threshold)
        op_str        = _OP_LABELS.get(rule["operator"], rule["operator"])
        rule_name     = rule.get("name") or f"{metric_lbl} alert"
        agent_label   = f" · {rule['agent_id']}" if rule.get("agent_id") else ""

        text = (
            f":rotating_light: *{rule_name}* fired\n"
            f"{metric_lbl}{agent_label}: *{actual_str}* (threshold: {op_str} {threshold_str})"
        )
        resp = httpx.post(webhook_url, json={"text": text}, timeout=8.0)
        if resp.status_code not in (200, 201, 204):
            logger.warning("[slack] Webhook returned %d", resp.status_code)
            return False
        return True
    except Exception as exc:
        logger.error("[slack] Failed to send Slack notification: %s", exc)
        return False
