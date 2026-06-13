# agentmetrics-anthropic

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-anthropic?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-anthropic)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for [Claude Managed Agents](https://docs.anthropic.com/en/docs/agents) (Python). Wrap your session event stream with one tracker and every session reports back to your dashboard when it terminates showing latency, cost, token counts with cache, tool calls, and errors.

---

## Install

```bash
pip install agentmetrics-anthropic
```

---

## Quickstart

```python
import anthropic
from agentmetrics_anthropic import AgentMetricsSessionTracker

client  = anthropic.Anthropic()
tracker = AgentMetricsSessionTracker(
    agent_id="my-claude-agent",
    base_url="http://localhost:8099",
)

# Sync stream
with tracker.stream(client, session_id="sess_...") as stream:
    for event in stream:
        pass  # handle events as normal

tracker.flush()
```

---

## Async

```python
async with tracker.astream(client, session_id="sess_...") as stream:
    async for event in stream:
        pass

await tracker.flush()
```

---

## API

### `AgentMetricsSessionTracker(agent_id, base_url)`

| Parameter | Default | Description |
|---|---|---|
| `agent_id` | `"anthropic-agent"` | Label shown in the dashboard |
| `base_url` | `"http://localhost:8099"` | AgentMetrics server address |

### `.stream(client, session_id, **kwargs)`

Returns a sync context manager. Yields the same events as `client.beta.sessions.events.stream()`. Emits a run summary on `session.status_terminated`.

### `.astream(client, session_id, **kwargs)`

Async version of `.stream()`.

### `.flush(timeout=10.0)`

Blocks until all in-flight HTTP requests complete. Call before process exit.

---

## What gets tracked

Each session emits one event to `/v1/events` when it terminates:

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock session duration |
| `input_tokens` / `output_tokens` | Aggregated across all LLM calls |
| `cache_read_tokens` / `cache_write_tokens` | Cache token counts |
| `llm_calls` | Number of LLM requests in the session |
| `tool_calls` / `tool_errors` | Tool usage counts |
| `tool_names` | Set of tools invoked |
| `model` | Model name from the first LLM call |
| `estimated_cost_usd` | Computed from token counts and model pricing |
| `error` | First 500 chars of the error message on failure |

---

## License

[MIT](../../LICENSE)
