# agentmetrics - Python SDK

[![PyPI](https://img.shields.io/pypi/v/agentmetrics?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-3776AB?logo=python&logoColor=white)](https://pypi.org/project/agentmetrics)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../LICENSE)

AgentMetrics Python SDK. Add `@agentmetrics.track` to any agent function and every run reports back to your dashboard showing latency, cost, token usage, tool calls, and failures, self-hosted with no account required.

---

## Install

```bash
pip install agentmetrics
```

Requires Python 3.9 or later.

---

## Quickstart

```python
import agentmetrics

agentmetrics.configure(base_url="http://localhost:8099")
agentmetrics.instrument()  # auto-patches OpenAI, Anthropic, LiteLLM, and more

@agentmetrics.track(agent_id="my-agent")
def run(task: str) -> str:
    answer = call_llm(task)
    return answer
```

Every call to `run()` reports to your dashboard showing duration, cost, token usage, tool calls, and when it failed.

---

## API

### `agentmetrics.configure()`

Call once at startup before any `@track` decorators execute.

```python
agentmetrics.configure(
    base_url="http://localhost:8099",  # AgentMetrics server address
    environment="production",          # optional, tags every run
    sample_rate=1.0,                   # optional, 0.0 to 1.0
    batch_size=20,                     # optional, events per batch
    flush_interval=2.0,                # optional, seconds between flushes
)
```

### `agentmetrics.instrument()`

Patches installed LLM SDKs to auto-capture token counts and model names on every call, and is safe to call multiple times.

```python
agentmetrics.instrument()
```

Supported: **OpenAI** (+ Azure, Groq, Together AI) · **Anthropic** · **LiteLLM** · **Google Gemini** · **Cohere** · **Mistral** · **LangChain / LangGraph / CrewAI** · **LlamaIndex**

### `@agentmetrics.track()`

Decorator for sync and async agent functions.

```python
@agentmetrics.track(agent_id="my-agent", metadata={"env": "prod"})
def run(task: str) -> str:
    return call_llm(task)

@agentmetrics.track(agent_id="async-agent")
async def run_async(task: str) -> str:
    return await call_llm_async(task)
```

| Parameter | Type | Description |
|---|---|---|
| `agent_id` | `str` | Identifier shown in the dashboard |
| `metadata` | `dict` | Optional key-value pairs attached to every run |

### `agentmetrics.step()`

Context manager for timing a named phase within a tracked agent.

```python
@agentmetrics.track(agent_id="pipeline")
def run(query: str) -> str:
    with agentmetrics.step("retrieve"):
        docs = vector_search(query)
    with agentmetrics.step("generate"):
        return call_llm(query, docs)
```

### `agentmetrics.tool()`

Context manager for tracking individual tool calls.

```python
@agentmetrics.track(agent_id="research-agent")
def run(query: str) -> str:
    with agentmetrics.tool("web_search"):
        results = web_search(query)
    return summarize(results)
```

### `agentmetrics.score()`

Attaches a named evaluation score to the current run. Call from inside a `@track` function.

```python
@agentmetrics.track(agent_id="my-agent")
def run(task: str) -> str:
    answer = call_llm(task)
    agentmetrics.score("relevance", 0.92)
    return answer
```

### `agentmetrics.flush()`

Blocks until all queued events are sent. Call before process exit in scripts.

```python
agentmetrics.flush(timeout=10.0)
```

### `agentmetrics.trace_id`

Returns the active trace ID from inside a tracked function.

```python
@agentmetrics.track(agent_id="my-agent")
def run(task: str) -> str:
    print(agentmetrics.trace_id)  # e.g. "a3f1c2d4-..."
    return call_llm(task)
```

---

## License

[MIT](../LICENSE)
