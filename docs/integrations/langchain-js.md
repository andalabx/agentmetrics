# LangChain.js Integration

Track cost, latency, token usage, and errors for LangChain.js chains and agents.

## Install

```bash
npm install agentmetrics-langchain
# or
pnpm add agentmetrics-langchain
```

## Quick Start

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { AgentMetricsCallbackHandler } from "agentmetrics-langchain";

const handler = new AgentMetricsCallbackHandler({
  apiKey: "am_your_key",
  serverUrl: "http://localhost:4000",
  agentId: "my-agent",
});

const model = new ChatOpenAI({ callbacks: [handler] });
const result = await model.invoke("What is 2 + 2?");
```

## With LangChain Agents

```typescript
import { AgentExecutor } from "langchain/agents";
import { AgentMetricsCallbackHandler } from "agentmetrics-langchain";

const handler = new AgentMetricsCallbackHandler({
  apiKey: "am_your_key",
  serverUrl: "http://localhost:4000",
  agentId: "calculator-agent",
  environment: "production",
});

const executor = AgentExecutor.fromAgentAndTools({
  agent,
  tools,
  callbacks: [handler],
});
const result = await executor.invoke({ input: "What is 100 * 42?" });
```

## Configuration

```typescript
new AgentMetricsCallbackHandler({
  apiKey: "am_your_key",       // required
  serverUrl: "http://localhost:4000",
  agentId: "my-agent",         // appears in dashboard
  environment: "production",
  version: "1.0.0",
})
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | LLM response metadata |
| Cost (USD) | Computed from model pricing table |
| Latency (ms) | Chain start → end |
| Tool calls & errors | `handleToolStart` / `handleToolError` |
| Error messages | `handleChainError` / `handleLLMError` |
| Model name | From LLM response |

## Notes

- ESM-only package (`"type": "module"`).
- Node.js 18+ required.
- The handler is instantiated per-session; a single instance can handle multiple concurrent chains.
