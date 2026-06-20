# OpenClaw Integration

Track cost, latency, token usage, and errors for agents built with OpenClaw (Claude Code plugin system).

## Overview

OpenClaw is a Claude Code plugin framework. The AgentMetrics OpenClaw integration instruments the Claude Code agent runtime, tracking each agent session as a run.

## Install

```bash
npm install agentmetrics-openclaw
```

Then add to your Claude Code settings:

```json
{
  "plugins": ["agentmetrics-openclaw"]
}
```

## Configuration

Set environment variables or add to `CLAUDE.md`:

```
AGENTMETRICS_API_KEY=am_your_key
AGENTMETRICS_SERVER_URL=http://localhost:4000
AGENTMETRICS_AGENT_ID=claude-code-agent
```

Or configure in code:

```typescript
import { configure } from "agentmetrics-openclaw";

configure({
  apiKey: "am_your_key",
  serverUrl: "http://localhost:4000",
  agentId: "claude-code-agent",
  environment: "local",
});
```

## What Gets Tracked

| Metric | Source |
|---|---|
| Input / output tokens | Claude API usage |
| Cache read / write tokens | Prompt cache statistics |
| Cost (USD) | Computed from Claude model pricing |
| Latency (ms) | Session start → end |
| Tool calls | Tool use blocks |
| Compactions | Context window compaction events |
| Resets | Session resets |
| Subagents spawned | Subagent invocations |

## Custom Model Pricing

If you're running proprietary or custom-hosted models through OpenClaw, you can register their pricing at plugin startup using `_registerModelPrices`. This takes priority over the built-in pricing table.

```typescript
import { _registerModelPrices } from "agentmetrics-openclaw";

// Format: model-name-prefix → [input, output, cacheRead?, cacheWrite?] ($ per 1M tokens)
_registerModelPrices({
  "my-fine-tuned-claude": [8.00, 24.00, 0.80, 10.00],
  "my-internal-model":    [2.00,  6.00],
});
```

**Key behaviours:**
- Keys are matched as prefix — `"my-fine-tuned-claude"` matches `"my-fine-tuned-claude-v2"` and `"my-fine-tuned-claude-20260101"`.
- Longer prefixes are checked first (more specific wins over generic).
- Provider namespace is stripped before lookup — `"openai/gpt-4o"` matches the key `"gpt-4o"`.
- Call `_registerModelPrices` as early as possible (before the first session starts).

## Notes

- Each Claude Code agent session maps to one run in the dashboard.
- Compaction and reset counts are unique metrics available only through the OpenClaw integration.
- The OpenClaw plugin includes built-in pricing for 30+ OpenClaw-hosted models (Trinity, Llama-4, DeepSeek, Kimi, GLM, Qwen3, Claude 4.x, etc.). Use `_registerModelPrices` only for models not already in the catalog.
