# OpenClaw Integration

Track cost, latency, token usage, and errors for agents built with OpenClaw (Claude Code plugin system).

## Overview

OpenClaw is a Claude Code plugin framework. The AgentMetrics OpenClaw integration instruments the Claude Code agent runtime, tracking each agent session as a run.

## Install

```bash
pip install agentmetrics
```

The OpenClaw integration is bundled with the core `agentmetrics` package and activated automatically when Claude Code with OpenClaw is detected.

## Configuration

Add to your Claude Code settings or `CLAUDE.md`:

```
AGENTMETRICS_API_KEY=am_your_key
AGENTMETRICS_SERVER_URL=http://localhost:4000
AGENTMETRICS_AGENT_ID=claude-code-agent
```

Or configure programmatically in your plugin:

```python
import agentmetrics

agentmetrics.configure(
    api_key="am_your_key",
    server_url="http://localhost:4000",
    agent_id="claude-code-agent",
    environment="local",
)
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | Claude API usage |
| Cache read / write tokens | Prompt cache statistics |
| Cost (USD) | Computed from Claude model pricing |
| Latency (ms) | Session start → end |
| Tool calls | Tool use blocks |
| Compactions | Context window compaction events |
| Resets | Session resets |
| Subagents spawned | Subagent invocations |

## Notes

- Each Claude Code agent session maps to one run in the dashboard.
- Compaction and reset counts are unique metrics available only through the OpenClaw integration.
