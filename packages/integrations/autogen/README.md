# agentmetrics-autogen

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-autogen?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-autogen)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for [AutoGen](https://microsoft.github.io/autogen/). Wrap `team.run_stream()` with one async context manager and every run reports back to your dashboard showing latency, tool calls, and errors. Token counts are not available from AutoGen's streaming events and are not tracked.

---

## Install

```bash
pip install agentmetrics-autogen
```

---

## Quickstart

```python
from agentmetrics_autogen import AgentMetricsRunStream

tracker = AgentMetricsRunStream(
    agent_id="my-autogen-team",
    base_url="http://localhost:8099",
)

async with tracker.run(team, task="Analyze this dataset") as stream:
    async for event in stream:
        pass  # handle events as normal

tracker.flush()
```

---

## API

### `AgentMetricsRunStream(agent_id, base_url)`

| Parameter | Default | Description |
|---|---|---|
| `agent_id` | `"autogen-agent"` | Label shown in the dashboard |
| `base_url` | `"http://localhost:8099"` | AgentMetrics server address |

### `.run(team, **kwargs)`

Returns an async context manager. Calls `team.run_stream(**kwargs)` internally. Yields a tracking iterator that intercepts `ToolCallRequestEvent`, `ToolCallExecutionEvent`, and `TaskResult` events to collect run metrics.

Emits a run summary to `/v1/events` on context exit (success or exception).

### `.flush(timeout=10.0)`

Blocks until all in-flight HTTP requests complete.

---

## What gets tracked

Each `.run()` call emits one event to `/v1/events` on completion or exception:

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock run duration |
| `tool_calls` | Number of `ToolCallRequestEvent` events |
| `tool_errors` | Number of tool results with `is_error=True` |
| `tool_names` | Set of tool names from request events |
| `error` | Error message if `TaskResult.stop_reason` contains "error" |

---

## License

[MIT](../../LICENSE)
