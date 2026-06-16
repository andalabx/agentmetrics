# OpenAI Agents Integration

Track cost, latency, token usage, and errors for the OpenAI Agents SDK (formerly Swarm).

## Install

```bash
pip install agentmetrics agentmetrics-openai-agents
```

## Quick Start

```python
import agentmetrics
from agentmetrics_openai_agents import instrument_openai_agents

agentmetrics.configure(api_key="am_your_key", server_url="http://localhost:4000")
instrument_openai_agents()

# Your existing agent code — no other changes needed
from openai_agents import Agent, Runner

agent = Agent(name="assistant", instructions="You are helpful.")
result = Runner.run_sync(agent, "Hello!")
```

## Per-Run Configuration

```python
instrument_openai_agents(
    agent_id="customer-support",
    environment="production",
    version="2.0.0",
)
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | Usage object from run result |
| Cached tokens | `cached_tokens` attribute (tries both `input_token_details` and `usage`) |
| Cost (USD) | Computed from model pricing table |
| Latency (ms) | Runner wall-clock time |
| Tool calls & errors | Per-tool invocation tracking |
| Subagents spawned | Handoff count |
| Error messages | Exception during run |
| Model name | Agent configuration |

## Notes

- `instrument_openai_agents()` is idempotent — a processor singleton is registered only once even if called multiple times.
- Compatible with both `openai-agents` (the newer SDK) and `openai.agents` (older).
