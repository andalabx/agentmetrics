# LangChain Integration

Track cost, latency, token usage, and errors for LangChain chains and agents.

## Install

```bash
pip install agentmetrics agentmetrics-langchain
```

## Quick Start

```python
import agentmetrics
from agentmetrics_langchain import AgentMetricsCallbackHandler

agentmetrics.configure(api_key="am_your_key", server_url="http://localhost:4000")

handler = AgentMetricsCallbackHandler()

chain = your_chain | handler   # or pass callbacks=[handler] to any chain/agent
result = chain.invoke({"input": "..."})
```

## With LangChain Agents

```python
from langchain.agents import AgentExecutor, create_openai_tools_agent
from agentmetrics_langchain import AgentMetricsCallbackHandler

handler = AgentMetricsCallbackHandler()

agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    callbacks=[handler],
)
result = agent_executor.invoke({"input": "..."})
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | LLM response metadata |
| Cache read / write tokens | `token_usage` from `llm_output` |
| Cost (USD) | Computed from model pricing table |
| Latency (ms) | Wall-clock from `on_chain_start` to `on_chain_end` |
| Tool calls & errors | `on_tool_start` / `on_tool_error` |
| Agent steps | Counted per `on_agent_action` |
| Error messages | `on_chain_error` / `on_llm_error` |
| Model name | From LLM response |

## Identifying Runs

```python
handler = AgentMetricsCallbackHandler(
    agent_id="customer-support-bot",
    environment="production",
    version="2.1.0",
)
```

## Notes

- The handler is thread-safe and can be reused across invocations.
- Nested chains are tracked as a single run; only the root span is reported.
- Cycle detection kicks in after 50 nested chain levels to prevent infinite loops.
- Up to 5,000 concurrent run IDs are tracked in memory; oldest are pruned if exceeded.
