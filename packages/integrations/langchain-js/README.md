# agentmetrics-langchain (JS/TS)

[![npm](https://img.shields.io/npm/v/agentmetrics-langchain?color=6366f1&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/agentmetrics-langchain)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for [LangChain.js](https://js.langchain.com). Pass one callback to any chain or agent `.invoke()` call and every run reports back to your dashboard showing latency, cost, token counts, tool calls, and errors, with no changes to your agent logic.

---

## Install

```bash
npm install agentmetrics-langchain
```

---

## Quickstart

```typescript
import { AgentMetricsCallback } from "agentmetrics-langchain";

const cb = new AgentMetricsCallback({
  agentId: "my-langchain-agent",
  baseUrl: "http://localhost:8099",
});

const result = await agent.invoke(
  { input: "What is the weather in Paris?" },
  { callbacks: [cb] },
);
```

---

## API

### `new AgentMetricsCallback(opts)`

| Option | Default | Description |
|---|---|---|
| `agentId` | `"langchain-agent"` | Label shown in the dashboard |
| `baseUrl` | `"http://localhost:8099"` | AgentMetrics server address |

Pass the callback via the `callbacks` array in the second argument to `.invoke()`. It implements `BaseCallbackHandler` from `@langchain/core` and tracks the top-level chain only, with all nested sub-chains aggregated into the same run.

Supports both OpenAI (`usage_metadata`) and Anthropic (`input_token_details`) token counting paths.

---

## What gets tracked

Each top-level chain invocation emits one event to `/v1/events` on completion or error:

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock chain duration |
| `input_tokens` / `output_tokens` | Aggregated across all LLM calls |
| `cache_read_tokens` / `cache_write_tokens` | Cache token counts (Anthropic) |
| `llm_calls` | Number of LLM requests in the chain |
| `tool_calls` / `tool_errors` | Tool usage counts |
| `tool_names` | Array of tools invoked |
| `model` | Model name from the first LLM call |
| `estimated_cost_usd` | Computed from token counts and model pricing |
| `error` | First 500 chars of the error message on failure |

---

## LangGraph.js

Works with LangGraph.js the same way:

```typescript
import { AgentMetricsCallback } from "agentmetrics-langchain";

const cb  = new AgentMetricsCallback({ baseUrl: "http://localhost:8099" });
const app = buildGraph().compile();

const result = await app.invoke(state, { callbacks: [cb] });
```

---

## License

[MIT](../../LICENSE)
