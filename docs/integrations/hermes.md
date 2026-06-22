# Hermes Integration

Track cost, latency, token usage, security events, and errors for agents running under the Hermes plugin framework.

## Overview

Hermes is a Claude Code plugin framework. The AgentMetrics Hermes integration is a native Python plugin that instruments the Hermes runtime, tracking each agent session end-to-end with automatic WAL-backed delivery, PII redaction, and security audit fields.

## Install

```bash
pip install agentmetrics-hermes
```

The Hermes plugin is auto-discovered via the `hermes_agent.plugins` entry-point — no import or code change needed.

## Configuration

Add to your `~/.hermes/config.yaml`:

```yaml
plugins:
  agentmetrics:
    enabled: true
    endpoint: http://localhost:8099
    api_key: am_your_key_here
  enabled:
    - agentmetrics
```

Environment variable equivalents (take precedence over the file):

| Variable | Description |
|---|---|
| `AGENTMETRICS_API_KEY` | API key |
| `AGENTMETRICS_URL` | Server URL (default: `http://localhost:8099`) |
| `AGENTMETRICS_AGENT_ID` | Agent identifier |
| `AGENTMETRICS_ENVIRONMENT` | Deployment environment |

## What Gets Tracked

| Metric | Source |
|---|---|
| Input / output tokens | LLM usage per session |
| Cache read / write tokens | Prompt cache statistics |
| Cost (USD) | Computed from model pricing (via `agentmetrics-shared`) |
| Latency (ms) | Session start → end wall-clock time |
| Tool calls & errors | Per-step tool tracking |
| Skills loaded | Hermes plugin lifecycle events |
| Memory writes | Hermes memory API calls |
| Session searches | Memory search calls |
| Delegation depth | Sub-agent invocation depth |
| Secrets blocked | Credentials redacted by the pipeline |
| PII detected | Personally identifiable information flagged |
| Error messages | Exception messages (secrets scrubbed) |
| LLM calls | Number of model API requests |

## WAL (Write-Ahead Log)

Events are written to a local WAL file before transmission to ensure delivery even when the server is unreachable. The WAL is stored at:

```
~/.hermes/agentmetrics-wal.jsonl
```

The WAL directory is created with `chmod 0700` — only the current user can read it. Events are retried automatically on the next flush cycle. Recovered events emit an `audit_wal_recovery` event that increments the `wal_recovered_count` pipeline counter in the dashboard.

## Security Audit Events

The Hermes plugin emits structured audit events that are tracked in the dashboard pipeline health view:

| Event name | Meaning | Dashboard counter |
|---|---|---|
| `audit_wal_recovery` | Events recovered from WAL after an outage | `wal_recovered_count` |
| `audit_access_denied` | Plugin action blocked by policy | `access_denied_count` |
| `audit_dlq_alert` | Event could not be delivered after retries | `dlq_alert_count` |

## Infrastructure Metrics

The Hermes plugin can forward host-level metrics to `/v1/infra/metrics`, correlating CPU, memory, and network usage with agent runs via `host_id`.

To enable, add to your config:

```yaml
infra_metrics:
  enabled: true
  interval_s: 30
```

## Notes

- The plugin is idempotent — safe to load multiple times.
- Circuit breaker: after 5 consecutive delivery failures the plugin backs off for 60s.
- Dead-letter queue: events that cannot be delivered after 10 retries are written to `~/.hermes/agentmetrics-dlq.json` and an `audit_dlq_alert` event is emitted.
- Each agent session maps to one run in the dashboard.
