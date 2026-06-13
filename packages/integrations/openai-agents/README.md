# agentmetrics-openai-agents

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-openai-agents?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-openai-agents)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for the [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/). Register one trace processor at startup and every agent run reports back to your dashboard showing latency, cost, token counts, tool calls, and errors, with zero changes to your agent code.

---

## Install

```bash
pip install agentmetrics-openai-agents
```

---

## Quickstart

```python
from agents.tracing import add_trace_processor
from agentmetrics_openai_agents import AgentMetricsProcessor

# register once at startup, covers all agents in the process
add_trace_processor(AgentMetricsProcessor(
    agent_id="my-openai-agent",
    base_url="http://localhost:8099",
))

# Run your agents as normal
result = await Runner.run(my_agent, "Summarize this document")
```

---

## API

### `AgentMetricsProcessor(agent_id, base_url)`

| Parameter | Default | Description |
|---|---|---|
| `agent_id` | `"openai-agent"` | Fallback label if the trace has no `name` attribute |
| `base_url` | `"http://localhost:8099"` | AgentMetrics server address |

Implements `TracingProcessor` from `agents.tracing`. Pass to `add_trace_processor()` before running any agents.

### `.force_flush()`

Blocks until all in-flight HTTP requests complete.

### `.shutdown()`

Calls `force_flush()`. Called automatically when the process exits cleanly.

---

## What gets tracked

Each agent trace emits one event to `/v1/events` when `on_trace_end` fires:

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock trace duration |
| `input_tokens` / `output_tokens` | Aggregated from all `LLMSpanData` spans |
| `cache_read_tokens` / `cache_write_tokens` | Cache token counts |
| `llm_calls` | Number of LLM spans in the trace |
| `tool_calls` / `tool_errors` | Counts from `FunctionSpanData` spans |
| `tool_names` | Set of function/tool names |
| `model` | Model name from the first LLM span output |
| `estimated_cost_usd` | Computed from token counts and model pricing |
| `error` | First 500 chars of the trace error on failure |

---

## License

[MIT](../../LICENSE)
