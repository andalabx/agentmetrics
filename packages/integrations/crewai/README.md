# agentmetrics-crewai

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-crewai?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-crewai)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for [CrewAI](https://docs.crewai.com). Instantiate the listener once at startup and every `crew.kickoff()` reports back to your dashboard automatically showing latency, cost, token counts, tool calls, and errors, with zero changes to your crew code.

---

## Install

```bash
pip install agentmetrics-crewai
```

---

## Quickstart

```python
from agentmetrics_crewai import AgentMetricsListener

# register once at startup, covers all crews in the process
AgentMetricsListener(
    agent_id="my-crew",
    base_url="http://localhost:8099",
)

# Run your crew as normal
result = MyCrew().kickoff()
```

---

## API

### `AgentMetricsListener(agent_id, base_url)`

| Parameter | Default | Description |
|---|---|---|
| `agent_id` | `"crewai-agent"` | Fallback label if the crew has no `crew_name` |
| `base_url` | `"http://localhost:8099"` | AgentMetrics server address |

Instantiating the class auto-registers event handlers on the global `crewai_event_bus` with no further setup needed, and the listener handles concurrent kickoffs correctly via `source_fingerprint` tracking.

### `.flush(timeout=10.0)`

Blocks until all in-flight HTTP requests complete. Call before process exit in scripts.

---

## What gets tracked

Each `kickoff()` call emits one event to `/v1/events` on completion or failure:

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock kickoff duration |
| `input_tokens` / `output_tokens` | Aggregated across all LLM calls |
| `cache_read_tokens` / `cache_write_tokens` | Cache token counts |
| `llm_calls` | Number of LLM requests in the kickoff |
| `tool_calls` / `tool_errors` | Tool usage counts |
| `tool_names` | Set of tools invoked |
| `model` | Model name from the first LLM call |
| `estimated_cost_usd` | Computed from token counts and model pricing |
| `error` | First 500 chars of the error message on failure |

---

## License

[MIT](../../LICENSE)
