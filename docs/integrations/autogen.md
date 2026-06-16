# AutoGen Integration

Track cost, latency, token usage, and errors for Microsoft AutoGen multi-agent conversations.

## Install

```bash
pip install agentmetrics agentmetrics-autogen
```

## Quick Start

```python
import agentmetrics
from agentmetrics_autogen import instrument_autogen

agentmetrics.configure(api_key="am_your_key", server_url="http://localhost:4000")
instrument_autogen()

# Your existing AutoGen code — no other changes needed
from autogen import AssistantAgent, UserProxyAgent

assistant = AssistantAgent("assistant", llm_config={"model": "gpt-4o"})
user_proxy = UserProxyAgent("user_proxy", human_input_mode="NEVER")

user_proxy.initiate_chat(assistant, message="Write a Python hello world.")
```

## Per-Run Configuration

```python
instrument_autogen(
    agent_id="code-writer-crew",
    environment="production",
    version="1.0.0",
)
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | Per-message usage stats |
| Cost (USD) | Computed from model pricing table |
| Latency (ms) | Conversation wall-clock time |
| Tool calls & errors | Function call tracking |
| Error messages | Structured `is_error` attribute detection |
| Agent steps | Message count |

## Notes

- Error detection uses AutoGen's structured `is_error` attribute rather than string matching for reliability.
- `instrument_autogen()` is idempotent — safe to call multiple times.
- `asyncio.CancelledError` is re-raised after recording so upstream cancellation handlers work correctly.
