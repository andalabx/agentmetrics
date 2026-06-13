# agentmetrics-langchain

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-langchain?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-langchain)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for [LangChain](https://python.langchain.com). Pass one callback to any chain or agent `.invoke()` call and every run reports back to your dashboard showing latency, cost, token counts, tool calls, and errors, with no changes to your agent logic.

---

## Install

```bash
pip install agentmetrics-langchain
```

---

## Quickstart

```python
from agentmetrics_langchain import AgentMetricsCallback

cb = AgentMetricsCallback(
    agent_id="my-langchain-agent",
    base_url="http://localhost:8099",
)

result = agent.invoke(
    {"input": "What is the weather in Paris?"},
    config={"callbacks": [cb]},
)

cb.flush()
```

---

## API

### `AgentMetricsCallback(agent_id, base_url)`

| Parameter | Default | Description |
|---|---|---|
| `agent_id` | `"langchain-agent"` | Label shown in the dashboard |
| `base_url` | `"http://localhost:8099"` | AgentMetrics server address |

The callback is a `BaseCallbackHandler`. Pass it via `config={"callbacks": [cb]}` on any chain or agent `.invoke()` call. It tracks the top-level chain only, with nested sub-chains aggregated into the same run.

Supports both OpenAI-style and Anthropic-style token counting from `usage_metadata` and `llm_output`.

### `.flush(timeout=10.0)`

Blocks until all in-flight HTTP requests complete. Call before process exit in scripts.

---

## What gets tracked

Each top-level chain invocation emits one event to `/v1/events` on completion or error:

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock chain duration |
| `input_tokens` / `output_tokens` | Aggregated across all LLM calls in the chain |
| `cache_read_tokens` / `cache_write_tokens` | Cache token counts (Anthropic) |
| `llm_calls` | Number of LLM requests in the chain |
| `tool_calls` / `tool_errors` | Tool usage counts |
| `tool_names` | Set of tools invoked |
| `model` | Model name from the first LLM call |
| `estimated_cost_usd` | Computed from token counts and model pricing |
| `error` | First 500 chars of the error message on failure |

---

## LangGraph

The callback works with LangGraph graphs the same way:

```python
from langgraph.graph import StateGraph
from agentmetrics_langchain import AgentMetricsCallback

cb  = AgentMetricsCallback(base_url="http://localhost:8099")
app = build_graph().compile()

result = app.invoke(state, config={"callbacks": [cb]})
```

---

## License

[MIT](../../LICENSE)
