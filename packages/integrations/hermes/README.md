# agentmetrics-hermes

[![npm](https://img.shields.io/npm/v/agentmetrics-hermes?color=6366f1&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/agentmetrics-hermes)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

AgentMetrics integration for [Hermes](https://hermesagent.dev). Registers as a plugin and tracks the full lifecycle of every session and run showing tokens, cost, tool calls, subagent delegation, skills, memory writes, cron jobs, gateway events, and reliability, with no changes to your agent code.

---

## Install

```bash
hermes plugins install agentmetrics-hermes
```

---

## Quickstart

In your Hermes config (`hermes.config.ts` or `hermes.json`):

```typescript
import agentmetrics from "agentmetrics-hermes";

export default {
  plugins: [agentmetrics],
  metrics: {
    endpoint: "http://localhost:8099",  // AgentMetrics server address
  },
};
```

Or set via environment variable instead:

```bash
export AGENTMETRICS_URL=http://localhost:8099
```

Replace `http://localhost:8099` with your server URL if it's running elsewhere.

---

## Configuration

All options are optional and can be set via the `metrics:` key in your Hermes config or as environment variables.

| Option | Env var | Default | Description |
|---|---|---|---|
| `endpoint` | `AGENTMETRICS_URL` | `http://localhost:8099` | AgentMetrics server address |
| `enabled` | — | `true` | Disable without removing the plugin |
| `flushInterval` | — | `10` (seconds) | How often to flush the event queue |
| `batchSize` | — | `100` | Max events per batch request |
| `queueSize` | — | `10000` | In-memory queue depth before FIFO drop |
| `retryMaxAttempts` | — | `5` | Max retries before moving to DLQ |
| `redactionMode` | — | `strict` | `strict` · `moderate` · `debug` |
| `exportedToolNames` | — | `blocklist` | `allowlist` · `blocklist` · `hash` · `off` |
| `redactToolNames` | — | `[]` | Tool names to redact (blocklist mode) |
| `compressPayloads` | — | `false` | Gzip batches larger than 1 KB |
| `costProviderTable` | — | `{}` | Custom per-model pricing overrides |

---

## What gets tracked

### Per run (emitted on `run_end`)

| Field | Description |
|---|---|
| `status` | `success` or `failed` |
| `duration_ms` | Wall-clock run duration |
| `input_tokens` / `output_tokens` | Aggregated from all LLM calls |
| `cache_read_tokens` / `cache_write_tokens` | Cache token counts |
| `tool_calls` / `tool_errors` | Tool usage counts |
| `tool_names` | Redacted list of tools invoked |
| `model` / `model_provider` | Model and provider from LLM calls |
| `estimated_cost_usd` | Computed from token counts and model pricing |
| `delegation_depth` | Subagent delegation nesting depth |
| `skills_loaded_count` | Number of skills loaded in this run |
| `memory_writes_count` | Number of memory writes |
| `session_search_calls` | Number of session search operations |

### Per session (emitted on `session_end`)

Aggregated totals for all runs in the session showing tokens, cost, tool calls, run count, compaction count, and reset count.

### Real-time activity stream

Every significant event (`llm_start`, `llm_end`, `tool_start`, `tool_end`, `subagent_start`, `subagent_end`, `cron_start`, `cron_end`, `gateway_connect`, `gateway_disconnect`, `compaction`, `reset`, etc.) is posted to `/v1/activity` for live dashboard updates.

---

## CLI commands

```bash
hermes agentmetrics status          # show config, counters, circuit breaker
hermes agentmetrics flush           # force-flush the event queue
hermes agentmetrics tail            # show in-flight run state
hermes agentmetrics test            # send a test event
hermes agentmetrics redaction-check # preview what redaction does to sample data
hermes agentmetrics drain           # retry all DLQ events
hermes agentmetrics cost            # show pricing table and custom overrides
```

---

## Reliability features

- **In-memory queue** with configurable FIFO overflow drop
- **WAL** (write-ahead log) at `~/.config/hermes/agentmetrics-wal.jsonl`, survives process crashes
- **Circuit breaker**, opens after 10 consecutive failures and probes again after 5 minutes
- **Dead-letter queue**, events that exhaust retries are held for manual drain

---

## License

[MIT](../../LICENSE)
