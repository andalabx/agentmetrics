# agentmetrics - JavaScript / TypeScript SDK

[![npm](https://img.shields.io/npm/v/agentmetrics?color=6366f1&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/agentmetrics)
[![Node 18+](https://img.shields.io/badge/node-18+-339933?logo=node.js&logoColor=white)](https://www.npmjs.com/package/agentmetrics)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../LICENSE)

AgentMetrics JavaScript/TypeScript SDK. Wrap any async agent function with `agentmetrics.track()` and every run reports back to your dashboard showing latency, cost, token usage, tool calls, and failures, self-hosted with no account required.

---

## Install

```bash
npm install agentmetrics
```

Requires Node.js 18 or later. Works with TypeScript, ESM, and CommonJS.

---

## Quickstart

```typescript
import agentmetrics from "agentmetrics";

agentmetrics.configure({ baseUrl: "http://localhost:8099" });
agentmetrics.instrument(); // auto-patches OpenAI and Anthropic

const run = agentmetrics.track("my-agent", async (task: string) => {
  const answer = await callLlm(task);
  return answer;
});

const result = await run("summarize this document");
```

---

## API

### `agentmetrics.configure()`

Call once at startup before any `track()` wrappers execute.

```typescript
agentmetrics.configure({
  baseUrl: "http://localhost:8099",  // AgentMetrics server address
  sampleRate: 1.0,                   // optional, 0.0 to 1.0
});
```

### `agentmetrics.instrument()`

Patches installed LLM SDKs to auto-capture token counts and model names on every call, and is safe to call multiple times.

```typescript
agentmetrics.instrument();
```

Supported: **OpenAI** (+ Azure, Groq, Together AI) · **Anthropic**

### `agentmetrics.track()`

Wraps an async agent function. Returns a new function with identical signature.

```typescript
const run = agentmetrics.track("my-agent", async (task: string) => {
  return await callLlm(task);
});

// With metadata
const run = agentmetrics.track(
  { agentId: "my-agent", metadata: { env: "production" } },
  async (task: string) => callLlm(task)
);
```

**Signature**

```typescript
agentmetrics.track(
  agentId: string | TrackOptions,
  fn: (...args: unknown[]) => Promise<unknown>
): (...args: Parameters<fn>) => Promise<ReturnType<fn>>
```

### `agentmetrics.step()`

Times a named phase within a tracked agent.

```typescript
const run = agentmetrics.track("pipeline", async (query: string) => {
  const docs = await agentmetrics.step("retrieve", () => vectorSearch(query));
  const answer = await agentmetrics.step("generate", () => callLlm(query, docs));
  return answer;
});
```

### `agentmetrics.tool()`

Tracks an individual tool call within a tracked agent.

```typescript
const run = agentmetrics.track("research-agent", async (query: string) => {
  const results = await agentmetrics.tool("web_search", () => webSearch(query));
  return summarize(results);
});
```

### `agentmetrics.score()`

Attaches a named evaluation score to the current run. Call from inside a `track()` wrapper.

```typescript
const run = agentmetrics.track("my-agent", async (task: string) => {
  const answer = await callLlm(task);
  agentmetrics.score("relevance", 0.92);
  return answer;
});
```

### `agentmetrics.flush()`

Drains all buffered events. Call before `process.exit()` in scripts.

```typescript
await agentmetrics.flush();
```

### `agentmetrics.traceId`

Returns the active trace ID from inside a tracked function.

```typescript
const run = agentmetrics.track("my-agent", async (task: string) => {
  console.log(agentmetrics.traceId); // "a3f1c2d4-..."
  return await callLlm(task);
});
```

---

## TypeScript

Full TypeScript types are bundled with the package.

```typescript
import agentmetrics, { type TrackOptions, type AgentMetricsOptions } from "agentmetrics";
```

## CommonJS

```javascript
const agentmetrics = require("agentmetrics");

agentmetrics.configure({ baseUrl: "http://localhost:8099" });
agentmetrics.instrument();

const run = agentmetrics.track("my-agent", async (task) => callLlm(task));
```

---

## License

[MIT](../LICENSE)
