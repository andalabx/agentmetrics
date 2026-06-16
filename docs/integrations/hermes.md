# Hermes Integration

Track cost, latency, token usage, and errors for agents using the Hermes agent framework.

## Overview

Hermes is a lightweight agent orchestration framework. The AgentMetrics Hermes integration instruments the Hermes runtime, tracking each agent run end-to-end.

## Install

```bash
pip install agentmetrics
```

The Hermes integration ships with the core `agentmetrics` package.

## Quick Start

```python
import agentmetrics
from agentmetrics.integrations.hermes import instrument_hermes

agentmetrics.configure(
    api_key="am_your_key",
    server_url="http://localhost:4000",
    agent_id="my-hermes-agent",
)
instrument_hermes()

# Your existing Hermes code — no other changes needed
```

## Configuration

```python
instrument_hermes(
    agent_id="my-hermes-agent",
    environment="production",
    version="1.0.0",
)
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | LLM usage per step |
| Cost (USD) | Computed from model pricing table |
| Latency (ms) | Agent run wall-clock time |
| Tool calls & errors | Per-step tool tracking |
| Error messages | Exception messages |
| Agent steps | Step count |

## Notes

- `instrument_hermes()` is idempotent — safe to call multiple times.
- Each `agent.run()` invocation is tracked as a separate run.
