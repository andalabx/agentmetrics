# Anthropic Integration (JavaScript)

Track cost, latency, token usage, and errors for the Anthropic JavaScript SDK.

## Install

```bash
npm install agentmetrics-anthropic
# or
pnpm add agentmetrics-anthropic
```

## Quick Start

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "agentmetrics-anthropic";

const client = wrapAnthropic(new Anthropic(), {
  apiKey: "am_your_key",
  serverUrl: "http://localhost:4000",
  agentId: "my-agent",
});

const message = await client.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude!" }],
});
```

## Configuration

```typescript
const client = wrapAnthropic(new Anthropic(), {
  apiKey: "am_your_key",       // required
  serverUrl: "http://localhost:4000",
  agentId: "my-agent",         // appears in dashboard
  environment: "production",
  version: "1.2.0",
});
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | `usage` from message response |
| Cache read / write tokens | `cache_read_input_tokens` / `cache_creation_input_tokens` |
| Cost (USD) | Computed from model pricing table |
| Latency (ms) | API call wall-clock time |
| Error messages | Thrown exception messages |
| Model name | `model` field in response |

## Notes

- Works with Claude Managed Agents (tool use, multi-turn) automatically.
- ESM-only package (`"type": "module"`).
- Node.js 18+ required.
