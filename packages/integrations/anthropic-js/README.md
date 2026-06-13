# agentmetrics-anthropic (JS/TS)

[![npm](https://img.shields.io/npm/v/agentmetrics-anthropic?color=6366f1&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/agentmetrics-anthropic)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for [Claude Managed Agents](https://docs.anthropic.com/en/docs/agents) (JavaScript/TypeScript). Wrap your session event stream with one tracker and every session reports back to your dashboard when it terminates showing latency, cost, token counts with cache, tool calls, and errors.

---

## Install

```bash
npm install agentmetrics-anthropic
```

---

## Quickstart

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { AgentMetricsSessionTracker } from "agentmetrics-anthropic";

const client  = new Anthropic();
const tracker = new AgentMetricsSessionTracker({
  agentId: "my-claude-agent",
  baseUrl: "http://localhost:8099",
});

// Wrap an existing stream
const rawStream = client.beta.sessions.events.stream("sess_...");
const tracked   = tracker.wrap(rawStream, "sess_...");

for await (const event of tracked) {
  // handle events as normal
}
```

---

## Higher-level helper

```typescript
await tracker.track(client, "sess_...", async (stream) => {
  for await (const event of stream) {
    // handle events
  }
});
```

---

## API

### `new AgentMetricsSessionTracker(opts)`

| Option | Default | Description |
|---|---|---|
| `agentId` | `"anthropic-agent"` | Label shown in the dashboard |
| `baseUrl` | `"http://localhost:8099"` | AgentMetrics server address |

### `.wrap(rawStream, sessionId)`

Returns a new async iterable that passes all events through unchanged. Emits a run summary when `session.status_terminated` is received or the iterator exhausts.

### `.track(client, sessionId, fn, ...streamArgs)`

Opens a session event stream, wraps it with tracking, and passes the tracked stream to `fn`. Emits metrics on completion or error.

---

## What gets tracked

Each session emits one event to `/v1/events` when it terminates:

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock session duration |
| `input_tokens` / `output_tokens` | Aggregated across all LLM calls |
| `cache_read_tokens` / `cache_write_tokens` | Cache token counts |
| `llm_calls` | Number of LLM requests in the session |
| `tool_calls` / `tool_errors` | Tool usage counts |
| `tool_names` | Array of tools invoked |
| `model` | Model name from the first LLM call |
| `estimated_cost_usd` | Computed from token counts and model pricing |
| `error` | First 500 chars of the error message on failure |

---

## License

[MIT](../../LICENSE)
