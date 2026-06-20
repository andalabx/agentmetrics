# agentmetrics-hermes

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-hermes?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-hermes)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics observability plugin for [Hermes](https://github.com/andalabx/hermes) agents. Auto-discovered via the `hermes_plugins` entry-point — no code changes needed.

---

## Install

```bash
pip install agentmetrics-hermes
```

---

## Configuration

Create `~/.config/hermes/agentmetrics.yaml`:

```yaml
api_key: am_your_key
server_url: http://localhost:4000
agent_id: my-hermes-agent
environment: production
```

Or set environment variables (take precedence over the file):

| Variable | Description |
|---|---|
| `AGENTMETRICS_API_KEY` | API key |
| `AGENTMETRICS_SERVER_URL` | Server URL |
| `AGENTMETRICS_AGENT_ID` | Agent identifier |
| `AGENTMETRICS_ENVIRONMENT` | Deployment environment |

---

## What gets tracked

| Metric | Description |
|---|---|
| `input_tokens` / `output_tokens` | Aggregated LLM token usage |
| `cache_read_tokens` / `cache_write_tokens` | Prompt cache statistics |
| `estimated_cost_usd` | Computed from model pricing |
| `duration_ms` | Session wall-clock time |
| `tool_calls` / `tool_errors` | Per-step tool tracking |
| `llm_calls` | Number of model API requests |
| `secrets_blocked_count` | Credentials redacted before transmission |
| `error` | Exception message on failure (secrets scrubbed) |

---

## Durability

Events are written to a local WAL before transmission. If the server is unreachable the plugin retries automatically via an internal circuit breaker. Events that exhaust all retries go to a dead-letter queue and are surfaced as `audit_dlq_alert` events.

---

## Security

All event payloads are scanned for API keys, JWTs, and passwords before transmission. Set `redaction_mode: debug` in the config to disable scrubbing during local development (expires automatically after a configurable TTL).

---

## License

[MIT](../../LICENSE)
