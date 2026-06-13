# agentmetrics-llamaindex

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-llamaindex?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-llamaindex)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for [LlamaIndex](https://docs.llamaindex.ai). Call `instrument()` once and every agent run and query engine response reports back to your dashboard showing latency, cost, token counts, tool calls, and errors, via LlamaIndex's native instrumentation API with zero changes to your agent code.

---

## Install

```bash
pip install agentmetrics-llamaindex
```

---

## Quickstart

```python
from agentmetrics_llamaindex import instrument

# Register on the global root dispatcher once at startup
span_handler = instrument(
    agent_id="my-llamaindex-agent",
    base_url="http://localhost:8099",
)

# Run your agents and query engines as normal
response = agent.chat("Summarize this document")

span_handler.flush()
```

---

## API

### `instrument(agent_id, base_url)`

Registers `AgentMetricsSpanHandler` and `AgentMetricsEventHandler` on the global LlamaIndex root dispatcher. Returns the span handler for flushing.

| Parameter | Default | Description |
|---|---|---|
| `agent_id` | `"llamaindex-agent"` | Fallback label if the agent has no `name` attribute |
| `base_url` | `"http://localhost:8099"` | AgentMetrics server address |

### `AgentMetricsSpanHandler`

LlamaIndex `BaseSpanHandler` that tracks top-level agent/engine spans. Emits a run summary on span completion or error.

### `AgentMetricsEventHandler`

LlamaIndex `BaseEventHandler` that accumulates token counts and tool calls from `LLMChatEndEvent`, `LLMCompletionEndEvent`, and `AgentToolCallEvent`.

### `.flush(timeout=10.0)`

Blocks until all in-flight HTTP requests complete.

---

## What gets tracked

Each top-level agent or query engine span emits one event to `/v1/events`:

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock span duration |
| `input_tokens` / `output_tokens` | Aggregated across all LLM calls |
| `cache_read_tokens` / `cache_write_tokens` | Cache token counts (Anthropic) |
| `llm_calls` | Number of LLM requests in the span |
| `tool_calls` | Tool call count from `AgentToolCallEvent` |
| `tool_names` | Set of tools invoked |
| `model` | Model name extracted from raw LLM response |
| `estimated_cost_usd` | Computed from token counts and model pricing |
| `error` | First 500 chars of the error message on failure |

The handler detects top-level spans by checking whether the span has no parent and whether the owning instance is an agent, engine, runner, or query object.

---

## License

[MIT](../../LICENSE)
