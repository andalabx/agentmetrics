# LlamaIndex Integration

Track cost, latency, token usage, and errors for LlamaIndex query engines and agents.

## Install

```bash
pip install agentmetrics agentmetrics-llamaindex
```

## Quick Start

```python
import agentmetrics
from agentmetrics_llamaindex import AgentMetricsEventHandler

agentmetrics.configure(api_key="am_your_key", server_url="http://localhost:4000")

handler = AgentMetricsEventHandler()

# Attach to a query engine
query_engine = index.as_query_engine(event_handlers=[handler])
response = query_engine.query("What is the capital of France?")
```

## With LlamaIndex Agents

```python
from llama_index.core.agent import ReActAgent
from agentmetrics_llamaindex import AgentMetricsEventHandler

handler = AgentMetricsEventHandler()

agent = ReActAgent.from_tools(tools, event_handlers=[handler])
response = agent.chat("What is 2 + 2?")
```

## Per-Run Configuration

```python
handler = AgentMetricsEventHandler(
    agent_id="document-qa",
    environment="production",
    version="1.0.0",
)
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | LLM response token counts (4 extraction paths) |
| Cache read / write tokens | Root span cache token attributes |
| Cost (USD) | Computed from model pricing table |
| Latency (ms) | Span start → end |
| Tool calls & errors | Tool span events |
| Error messages | Exception events |
| Model name | LLM span attributes |

## Notes

- Token extraction tries four different attribute paths to handle LlamaIndex version differences.
- The handler attaches to LlamaIndex's instrumentation system and does not require monkey-patching.
