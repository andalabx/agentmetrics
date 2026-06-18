import { createHash, randomUUID } from "crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { dirname, join } from "path";
import { hashName as _hashName, scrubSecrets as _scrubSecrets, PRICING as _PRICING } from "../plugin-core/core.js";


let API_KEY: string | undefined;
let BASE_URL: string;

let ENABLED               = true;
let REDACTION_MODE: "strict" | "moderate" | "debug" = "strict";
let EXPORTED_TOOL_NAMES: "allowlist" | "blocklist" | "hash" | "off" = "blocklist";
let REDACT_TOOL_NAMES: string[]  = [];
let DEBUG_EXPIRES_AT: number | null = null;

let FLUSH_INTERVAL_MS  = 10_000;
let MAX_BATCH_SIZE     = 100;
let MAX_QUEUE_SIZE     = 10_000;
let RETRY_MAX_ATTEMPTS = 5;
let COMPRESS_PAYLOADS  = false;
let COST_PROVIDER_TABLE: Record<string, [number, number, number?, number?]> = {};


const _metrics = { sent: 0, failed: 0, dropped: 0 };


interface QueuedEvent {
  payload:    Record<string, unknown>;
  attempt:    number;
  enqueuedAt: number;
}
const _queue: QueuedEvent[] = [];
const _dlq:   QueuedEvent[] = [];


const CB_THRESHOLD = 10;
const CB_PROBE_MS  = 5 * 60_000;
type CbState = "closed" | "open" | "half-open";
let _cbState: CbState      = "closed";
let _cbConsecFails          = 0;
let _cbOpenAt: number | null = null;


let WAL_PATH: string | null = null;
let _flushTimer: ReturnType<typeof setInterval> | null = null;

let _registered = false;


interface PluginApi {
  config:        Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  registerAutoEnableProbe?: (probe: () => boolean) => void;
  registerCli?: (registrar: {
    name:        string;
    description: string;
    commands:    Array<{ name: string; description: string; handler: () => void | Promise<void> }>;
  }) => void;
  on: (hookName: string, handler: (...args: unknown[]) => void) => void;
}


type HermesAgentContext = {
  runId?:           string;
  agentId?:         string;
  sessionKey?:      string;
  sessionId?:       string;
  delegationDepth?: number;
};

type HermesSessionContext = {
  sessionId:   string;
  sessionKey?: string;
  agentId?:    string;
};

type HermesToolContext = {
  agentId?:    string;
  sessionKey?: string;
  sessionId?:  string;
  runId?:      string;
  toolName:    string;
  toolCallId?: string;
};

type HermesSubagentContext = {
  runId?:            string;
  parentSessionKey?: string;
  delegationDepth?:  number;
};

type HermesSessionStartEvent = {
  sessionId:    string;
  sessionKey?:  string;
  resumedFrom?: string;
};

type HermesSessionEndEvent = {
  sessionId:     string;
  sessionKey?:   string;
  durationMs?:   number;
  messageCount?: number;
  reason?:       string;
};

type HermesRunStartEvent = {
  runId:            string;
  sessionKey?:      string;
  sessionId?:       string;
  agentId?:         string;
  delegationDepth?: number;
};

type HermesRunEndEvent = {
  runId:            string;
  success:          boolean;
  error?:           string;
  durationMs?:      number;
  messages?:        unknown[];
  delegationDepth?: number;
};

type HermesLlmInputEvent = {
  runId:            string;
  sessionKey?:      string;
  provider:         string;
  model:            string;
  systemPrompt?:    string;
  prompt:           string;
  historyMessages?: unknown[];
  imagesCount?:     number;
};

type HermesLlmOutputEvent = {
  runId:       string;
  sessionKey?: string;
  provider:    string;
  model:       string;
  assistantTexts?: string[];
  usage?: {
    input?:      number;
    output?:     number;
    cacheRead?:  number;
    cacheWrite?: number;
  };
};

type HermesBeforeToolCallEvent = {
  toolName:    string;
  params?:     Record<string, unknown>;
  runId?:      string;
  toolCallId?: string;
};

type HermesAfterToolCallEvent = {
  toolName:    string;
  params?:     Record<string, unknown>;
  runId?:      string;
  toolCallId?: string;
  result?:     unknown;
  error?:      string;
  durationMs?: number;
};

type HermesSubagentSpawnEvent = {
  childSessionKey:  string;
  agentId:          string;
  label?:           string;
  delegationDepth?: number;
};

type HermesSubagentEndEvent = {
  targetSessionKey: string;
  runId?:           string;
  outcome?:         "ok" | "error" | "timeout" | "killed";
  error?:           string;
};

type HermesSkillLoadEvent = {
  skillName: string;
  version?:  string;
};

type HermesMemoryWriteEvent = {
  key:        string;
  valueType?: string;
};

type HermesSessionSearchEvent = {
  query?:        string;
  resultsCount?: number;
};

type HermesCronStartEvent = {
  cronjobId: string;
  cronRunId: string;
  schedule?: string;
};

type HermesCronEndEvent = {
  cronjobId:   string;
  cronRunId:   string;
  success:     boolean;
  error?:      string;
  durationMs?: number;
};

type HermesGatewayConnectEvent    = { remoteId?: string; protocol?: string; };
type HermesGatewayDisconnectEvent = { remoteId?: string; reason?: string; code?: number; };
type HermesGatewayReconnectEvent  = { remoteId?: string; attempt?: number; };

type HermesRetryEvent   = { reason?: string; attempt?: number; };
type HermesTimeoutEvent = { durationMs?: number; };
type HermesCancelEvent  = { reason?: string; };
type HermesFailureEvent = { error?: string; };

type HermesCompactionEvent = { messageCount?: number; tokenCount?: number; };
type HermesResetEvent      = { reason?: string; };


interface SessionMeta {
  traceId:     string;
  agentId:     string;
  startedAt:   number;
  compactions: number;
  resets:      number;
  runCount:              number;
  totalInputTokens:      number;
  totalOutputTokens:     number;
  totalCacheReadTokens:  number;
  totalCacheWriteTokens: number;
  totalToolCalls:        number;
  totalEstimatedCostUsd: number;
  totalDurationMs:       number;
}

interface RunMeta {
  inputTokens:        number;
  outputTokens:       number;
  cacheReadTokens:    number;
  cacheWriteTokens:   number;
  llmCalls:           number;
  imagesCount:        number;
  toolCalls:          number;
  toolErrors:         number;
  toolNames:          Set<string>;
  subagentsSpawned:   number;
  subagentErrors:     number;
  skillsLoadedCount:  number;
  skillNames:         Set<string>;
  memoryWritesCount:  number;
  sessionSearchCalls: number;
  delegationDepth:    number;
  gatewayDisconnects: number;
  reconnects:         number;
  cronjobId?:         string;
  cronRunId?:         string;
  model?:             string;
  provider?:          string;
  sessionKey?:        string;
  startedAt:          number;
}

const sessions = new Map<string, SessionMeta>();
const runs     = new Map<string, RunMeta>();


function _walAppend(payload: Record<string, unknown>): void {
  if (!WAL_PATH) return;
  try {
    appendFileSync(WAL_PATH, JSON.stringify(payload) + "\n", "utf8");
  } catch (err) {
    console.warn(`AgentMetrics: WAL append failed - ${err instanceof Error ? err.message : String(err)}`);
  }
}

function _walCompact(sentIds: Set<string>): void {
  if (!WAL_PATH || !existsSync(WAL_PATH)) return;
  try {
    const lines = readFileSync(WAL_PATH, "utf8").split("\n").filter(Boolean);
    const kept  = lines.filter((line) => {
      try {
        const ev = JSON.parse(line) as Record<string, unknown>;
        return !sentIds.has(String(ev.event_id ?? ""));
      } catch { return false; }
    });
    writeFileSync(WAL_PATH, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  } catch (err) {
    console.warn(`AgentMetrics: WAL compact failed - ${err instanceof Error ? err.message : String(err)}`);
  }
}

function _walRecover(): void {
  if (!WAL_PATH || !existsSync(WAL_PATH)) return;
  try {
    const lines = readFileSync(WAL_PATH, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const payload = JSON.parse(line) as Record<string, unknown>;
        _enqueue(payload, true);
      } catch { /* skip corrupt lines */ }
    }
    if (lines.length > 0) {
      console.log(`AgentMetrics: recovered ${lines.length} event(s) from WAL`);
    }
  } catch (err) {
    console.warn(`AgentMetrics: WAL recovery failed - ${err instanceof Error ? err.message : String(err)}`);
  }
}


function _enqueue(payload: Record<string, unknown>, fromWal = false): void {
  if (_queue.length >= MAX_QUEUE_SIZE) {
    _queue.shift(); // FIFO: drop oldest on overflow
    _metrics.dropped += 1;
  }
  _queue.push({ payload, attempt: 0, enqueuedAt: Date.now() });
  if (!fromWal) _walAppend(payload);
}


function _cbIsOpen(): boolean {
  if (_cbState === "closed") return false;
  if (_cbState === "open") {
    if (_cbOpenAt !== null && Date.now() - _cbOpenAt >= CB_PROBE_MS) {
      _cbState = "half-open";
      return false; // let one probe through
    }
    return true;
  }
  return false; // half-open: probe is allowed
}

function _cbOnSuccess(): void {
  if (_cbState !== "closed") {
    console.log("AgentMetrics: circuit breaker closed - delivery resumed");
  }
  _cbState       = "closed";
  _cbConsecFails = 0;
  _cbOpenAt      = null;
}

function _cbOnFailure(): void {
  _cbConsecFails += 1;
  if (_cbState === "half-open" || _cbConsecFails >= CB_THRESHOLD) {
    _cbState  = "open";
    _cbOpenAt = Date.now();
    console.log(
      `AgentMetrics: circuit breaker opened after ${_cbConsecFails} consecutive failures - ` +
      `probing again in ${CB_PROBE_MS / 60_000}min`,
    );
  }
}


function _buildHeaders(): Record<string, string> {
  return {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${API_KEY}`,
  };
}

function _maybeGzip(body: string): { body: string | Uint8Array; extra: Record<string, string> } {
  if (COMPRESS_PAYLOADS && body.length > 1024) {
    try {
      return {
        body:  gzipSync(Buffer.from(body, "utf8")),
        extra: { "Content-Encoding": "gzip" },
      };
    } catch { /* fall through */ }
  }
  return { body, extra: {} };
}

function _requeue(batch: QueuedEvent[]): void {
  for (const item of batch) {
    item.attempt    += 1;
    _metrics.failed += 1;
    if (item.attempt >= RETRY_MAX_ATTEMPTS) {
      _dlq.push(item);
    } else {
      _queue.push(item); // back of queue - prevent starvation
    }
  }
}

async function _flushBatch(batch: QueuedEvent[]): Promise<void> {
  const rawBody         = JSON.stringify({ events: batch.map((e) => e.payload) });
  const { body, extra } = _maybeGzip(rawBody);
  try {
    const resp = await fetch(`${BASE_URL}/v1/events/batch`, {
      method:  "POST",
      headers: { ..._buildHeaders(), ...extra },
      body,
    });
    if (resp.ok) {
      _cbOnSuccess();
      _metrics.sent += batch.length;
      _walCompact(new Set(batch.map((e) => String(e.payload.event_id ?? ""))));
    } else if (resp.status === 404) {
      await _flushIndividual(batch);
    } else {
      _cbOnFailure();
      _requeue(batch);
    }
  } catch {
    _cbOnFailure();
    _requeue(batch);
  }
}

async function _flushIndividual(batch: QueuedEvent[]): Promise<void> {
  for (const item of batch) {
    const rawBody         = JSON.stringify(item.payload);
    const { body, extra } = _maybeGzip(rawBody);
    try {
      const resp = await fetch(`${BASE_URL}/v1/events`, {
        method:  "POST",
        headers: { ..._buildHeaders(), ...extra },
        body,
      });
      if (resp.ok) {
        _cbOnSuccess();
        _metrics.sent += 1;
        _walCompact(new Set([String(item.payload.event_id ?? "")]));
      } else {
        _cbOnFailure();
        _requeue([item]);
      }
    } catch {
      _cbOnFailure();
      _requeue([item]);
    }
  }
}

async function _flush(): Promise<void> {
  if (!API_KEY || _queue.length === 0 || _cbIsOpen()) return;
  const batch = _queue.splice(0, MAX_BATCH_SIZE);
  await _flushBatch(batch);
}


function send(payload: Record<string, unknown>): void {
  if (!API_KEY || !ENABLED) return;
  _enqueue(payload);
}

function sendActivity(
  type:       string,
  agentId:    string,
  sessionKey: string | undefined,
  runId:      string | undefined,
  data?:      Record<string, unknown>,
): void {
  if (!API_KEY || !ENABLED) return;
  const payload = JSON.stringify({
    type,
    agent_id:    agentId,
    session_key: sessionKey,
    run_id:      runId,
    ts:          Date.now(),
    data:        data ?? null,
  });
  fetch(`${BASE_URL}/v1/activity`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: payload,
  }).catch(() => {});
}

function emptyRun(sessionKey?: string): RunMeta {
  return {
    inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    llmCalls: 0, imagesCount: 0,
    toolCalls: 0, toolErrors: 0, toolNames: new Set(),
    subagentsSpawned: 0, subagentErrors: 0,
    skillsLoadedCount: 0, skillNames: new Set(),
    memoryWritesCount: 0, sessionSearchCalls: 0,
    delegationDepth: 0, gatewayDisconnects: 0, reconnects: 0,
    sessionKey,
    startedAt: Date.now(),
  };
}



function _activeMode(): "strict" | "moderate" | "debug" {
  if (DEBUG_EXPIRES_AT !== null) {
    if (Date.now() < DEBUG_EXPIRES_AT) return "debug";
    DEBUG_EXPIRES_AT = null;
    console.log("AgentMetrics: debug mode expired - reverting to strict redaction");
  }
  return REDACTION_MODE;
}

function _redactError(err: string | undefined, activityStream = false): string | undefined {
  if (!err) return err;
  const mode   = _activeMode();
  if (mode === "debug") return err;
  const maxLen = (mode === "strict" || activityStream) ? 200 : 500;
  return _scrubSecrets(err).slice(0, maxLen);
}

function _redactToolName(name: string): string {
  const mode = _activeMode();
  if (mode === "debug") return name;
  switch (EXPORTED_TOOL_NAMES) {
    case "off":
      return "[REDACTED]";
    case "hash":
      return _hashName(name);
    case "allowlist":
      return REDACT_TOOL_NAMES.includes(name) ? name : `[REDACTED:${_hashName(name)}]`;
    case "blocklist":
    default:
      return REDACT_TOOL_NAMES.includes(name) ? `[REDACTED:${_hashName(name)}]` : name;
  }
}

function _redactToolNames(names: string[]): string[] {
  return names.map(_redactToolName);
}


function _skillNamesHash(names: Set<string>): string | undefined {
  if (names.size === 0) return undefined;
  return createHash("sha256").update(JSON.stringify([...names].sort())).digest("hex");
}



function _estimateCost(
  model:      string | undefined,
  input:      number,
  output:     number,
  cacheRead:  number,
  cacheWrite: number,
): number | undefined {
  if (!model) return undefined;
  const key   = model.toLowerCase();
  const rates =
    COST_PROVIDER_TABLE[key] ??
    COST_PROVIDER_TABLE[key.replace(/-\d{8}$/, "")] ??
    _PRICING[key] ??
    _PRICING[key.replace(/-\d{8}$/, "")];
  if (!rates) return undefined;
  const M = 1_000_000;
  return (
    input      * rates[0]          / M +
    output     * rates[1]          / M +
    cacheRead  * (rates[2] ?? 0)   / M +
    cacheWrite * (rates[3] ?? 0)   / M
  );
}


const plugin = {
  id:          "agentmetrics",
  name:        "AgentMetrics",
  description: "360-degree observability for every Hermes agent - skills, memory, cron jobs, gateway events, tokens, tools, latency, cost, subagents, and reliability.",
  configSchema: {
    type: "object",
    properties: {
      apiKey: {
        type:        "string",
        description: "AgentMetrics API key (overrides AGENTMETRICS_API_KEY env var)",
      },
      endpoint: {
        type:        "string",
        description: "Custom API endpoint (default: http://localhost:8099)",
      },
      enabled: {
        type:        "boolean",
        description: "Disable the plugin without removing it (default: true)",
      },
      flushInterval: {
        type:        "number",
        description: "How often to flush the event queue to the API in seconds (default: 10)",
      },
      batchSize: {
        type:        "number",
        description: "Maximum events per batch request (default: 100)",
      },
      queueSize: {
        type:        "number",
        description: "Maximum in-memory queue depth before FIFO drop (default: 10000)",
      },
      retryMaxAttempts: {
        type:        "number",
        description: "Max retry attempts before moving event to DLQ (default: 5)",
      },
      redactionMode: {
        type:        "string",
        enum:        ["strict", "moderate", "debug"],
        description: "PII redaction level applied to prompts/completions (default: strict)",
      },
      exportedToolNames: {
        type:        "string",
        enum:        ["allowlist", "blocklist", "hash", "off"],
        description: "Which tool names to include in exports (default: blocklist)",
      },
      redactToolNames: {
        type:        "array",
        items:       { type: "string" },
        description: "Tool names to redact when exportedToolNames is 'blocklist'",
      },
      compressPayloads: {
        type:        "boolean",
        description: "Gzip-compress batch payloads larger than 1 KB (default: false)",
      },
      costProviderTable: {
        type:        "object",
        description: "Custom per-model pricing overrides (USD per million tokens). Each key is a model ID; value is [input, output] or [input, output, cacheRead, cacheWrite].",
        additionalProperties: {
          type:  "array",
          items: { type: "number" },
        },
      },
    },
    additionalProperties: false,
  } as const,

  register(api: PluginApi) {
    if (_registered) {
      console.warn(
        "\n  AgentMetrics: ⚠ register() called twice - possible duplicate instrumentation.\n" +
        "  If you have both the plugin and an SDK hook active, remove one to avoid\n" +
        "  double-counting runs and inflated token/cost totals.\n",
      );
    }
    _registered = true;

    API_KEY  = (api.pluginConfig?.apiKey  as string | undefined) ?? process.env.AGENTMETRICS_API_KEY;
    BASE_URL = (
      (api.pluginConfig?.endpoint as string | undefined) ??
      process.env.AGENTMETRICS_URL ??
      "http://localhost:8099"
    ).replace(/\/$/, "");

    ENABLED              = (api.pluginConfig?.enabled          as boolean | undefined) ?? true;
    REDACTION_MODE       = (api.pluginConfig?.redactionMode     as typeof REDACTION_MODE    | undefined) ?? "strict";
    EXPORTED_TOOL_NAMES  = (api.pluginConfig?.exportedToolNames as typeof EXPORTED_TOOL_NAMES | undefined) ?? "blocklist";
    REDACT_TOOL_NAMES    = (api.pluginConfig?.redactToolNames   as string[] | undefined) ?? [];
    FLUSH_INTERVAL_MS    = ((api.pluginConfig?.flushInterval    as number | undefined) ?? 10) * 1000;
    MAX_BATCH_SIZE       = (api.pluginConfig?.batchSize         as number | undefined) ?? 100;
    MAX_QUEUE_SIZE       = (api.pluginConfig?.queueSize         as number | undefined) ?? 10_000;
    RETRY_MAX_ATTEMPTS   = (api.pluginConfig?.retryMaxAttempts  as number | undefined) ?? 5;
    COMPRESS_PAYLOADS    = (api.pluginConfig?.compressPayloads  as boolean | undefined) ?? false;
    COST_PROVIDER_TABLE  = (api.pluginConfig?.costProviderTable as typeof COST_PROVIDER_TABLE | undefined) ?? {};

    if (REDACTION_MODE === "debug") {
      DEBUG_EXPIRES_AT = Date.now() + 60 * 60 * 1000;
      console.log("AgentMetrics: ⚠ debug redaction mode active - expires in 1 hour");
    }

    if (typeof api.registerAutoEnableProbe === "function") {
      api.registerAutoEnableProbe(() => !!API_KEY && ENABLED);
    }

    if (!ENABLED) {
      console.log("\n  AgentMetrics: disabled via config (metrics.enabled: false)\n");
      return;
    }

    if (!API_KEY) {
      console.log(
        "\n  AgentMetrics: no API key found.\n" +
        "  Your agent runs are not being tracked.\n" +
        "  Start AgentMetrics (see README) and set AGENTMETRICS_API_KEY.\n" +
        "  AGENTMETRICS_URL defaults to http://localhost:8099.\n",
      );
      return;
    }

    try {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
      WAL_PATH   = join(home, ".config", "hermes", "agentmetrics-wal.jsonl");
      mkdirSync(dirname(WAL_PATH), { recursive: true });
      try { chmodSync(dirname(WAL_PATH), 0o700); } catch {}
      _walRecover();
    } catch {
      WAL_PATH = null; // WAL unavailable - queue still works in-memory
    }

    if (_flushTimer) clearInterval(_flushTimer);
    _flushTimer = setInterval(() => { _flush().catch(() => {}); }, FLUSH_INTERVAL_MS);
    if (typeof (_flushTimer as unknown as { unref?: () => void }).unref === "function") {
      (_flushTimer as unknown as { unref: () => void }).unref();
    }

    console.log(
      `\n  AgentMetrics active - sending data to ${BASE_URL}\n` +
      `  Queue: max ${MAX_QUEUE_SIZE} events, batch ${MAX_BATCH_SIZE}, flush every ${FLUSH_INTERVAL_MS / 1000}s\n` +
      `  View your dashboard → http://localhost:3099\n`,
    );

    if (typeof api.registerCli === "function") {
      api.registerCli({
        name:        "agentmetrics",
        description: "AgentMetrics observability commands",
        commands: [
          {
            name:        "status",
            description: "Show current plugin status, config, delivery counters, and circuit breaker state",
            handler() {
              const keyPreview = API_KEY
                ? `${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`
                : "(not set)";
              const mode   = _activeMode();
              const cbInfo = _cbState === "open" && _cbOpenAt
                ? ` (opens probe at ${new Date(_cbOpenAt + CB_PROBE_MS).toLocaleTimeString()})`
                : "";
              console.log("AgentMetrics - status");
              console.log(`  API key            : ${keyPreview}`);
              console.log(`  Endpoint           : ${BASE_URL}`);
              console.log(`  Redaction          : ${mode}${mode === "debug" && DEBUG_EXPIRES_AT ? ` (expires ${new Date(DEBUG_EXPIRES_AT).toLocaleTimeString()})` : ""}`);
              console.log(`  Tool names         : ${EXPORTED_TOOL_NAMES}`);
              console.log(`  Compress payloads  : ${COMPRESS_PAYLOADS}`);
              console.log(`  Flush interval     : ${FLUSH_INTERVAL_MS / 1000}s`);
              console.log(`  WAL path           : ${WAL_PATH ?? "(unavailable)"}`);
              console.log(`  Cost overrides     : ${Object.keys(COST_PROVIDER_TABLE).length} model(s)`);
              console.log("");
              console.log(`  Circuit breaker    : ${_cbState}${cbInfo}`);
              console.log(`  Queue depth        : ${_queue.length} / ${MAX_QUEUE_SIZE}`);
              console.log(`  DLQ depth          : ${_dlq.length}`);
              console.log(`  Sessions tracked   : ${sessions.size}`);
              console.log(`  Runs in flight     : ${runs.size}`);
              console.log("");
              console.log(`  Sent               : ${_metrics.sent}`);
              console.log(`  Failed             : ${_metrics.failed}`);
              console.log(`  Dropped (overflow) : ${_metrics.dropped}`);
            },
          },
          {
            name:        "flush",
            description: "Force-flush all queued events immediately",
            async handler() {
              const before = _queue.length;
              if (before === 0) {
                console.log("AgentMetrics flush - queue empty, nothing to flush");
                return;
              }
              if (_cbIsOpen()) {
                console.log(`AgentMetrics flush - circuit breaker is ${_cbState}, skipping`);
                return;
              }
              console.log(`AgentMetrics flush - flushing ${before} event(s)…`);
              while (_queue.length > 0 && !_cbIsOpen()) {
                await _flush();
              }
              console.log(`  Done - sent: ${_metrics.sent}, failed: ${_metrics.failed}, queued: ${_queue.length}`);
            },
          },
          {
            name:        "tail",
            description: "Show recent in-flight run state including Hermes-specific counters",
            handler() {
              if (runs.size === 0 && sessions.size === 0) {
                console.log("AgentMetrics tail - no active sessions or runs");
                return;
              }
              console.log("AgentMetrics tail - active state");
              if (sessions.size > 0) {
                console.log(`  Sessions (${sessions.size}):`);
                for (const [key, s] of sessions) {
                  console.log(`    ${key.slice(0, 12)}… agent=${s.agentId} compactions=${s.compactions} resets=${s.resets}`);
                }
              }
              if (runs.size > 0) {
                console.log(`  Runs in flight (${runs.size}):`);
                for (const [id, r] of runs) {
                  const age = Math.round((Date.now() - r.startedAt) / 1000);
                  console.log(
                    `    ${id.slice(0, 12)}… llm=${r.llmCalls} tools=${r.toolCalls} ` +
                    `skills=${r.skillsLoadedCount} mem_writes=${r.memoryWritesCount} ` +
                    `depth=${r.delegationDepth} ${age}s elapsed`,
                  );
                }
              }
            },
          },
          {
            name:        "test",
            description: "Send a test event and verify end-to-end delivery",
            async handler() {
              if (!API_KEY) {
                console.log("AgentMetrics test - no API key set, cannot send");
                return;
              }
              console.log(`AgentMetrics test - sending to ${BASE_URL}…`);
              try {
                const resp = await fetch(`${BASE_URL}/v1/events`, {
                  method: "POST",
                  headers: {
                    "Content-Type":  "application/json",
                    "Authorization": `Bearer ${API_KEY}`,
                  },
                  body: JSON.stringify({
                    event_id:                 randomUUID(),
                    trace_id:                 randomUUID(),
                    agent_id:                 "agentmetrics-test",
                    platform:                 "hermes",
                    event_name:               "agent_end",
                    ts:                       Date.now(),
                    status:                   "success",
                    duration_ms:              1,
                    redaction_policy_version: `v1-${_activeMode()}`,
                  }),
                });
                if (resp.ok) {
                  console.log(`  ✓ Delivered - HTTP ${resp.status}`);
                } else {
                  const body = await resp.text().catch(() => "");
                  console.log(`  ✗ Failed - HTTP ${resp.status} ${body.slice(0, 200)}`);
                }
              } catch (err) {
                console.log(`  ✗ Failed - ${err}`);
              }
            },
          },
          {
            name:        "redaction-check",
            description: "Show what the current redaction policy does to a sample payload",
            handler() {
              const mode        = _activeMode();
              const sampleError = "Connection failed: Bearer sk-ant-abc123exampletoken and api_key=supersecret";
              const sampleTools = ["bash", "read_file", "write_file", "send_email"];
              console.log("AgentMetrics redaction-check");
              console.log(`  Mode          : ${mode}`);
              console.log(`  Tool export   : ${EXPORTED_TOOL_NAMES}`);
              console.log(`  Blocked names : ${REDACT_TOOL_NAMES.length ? REDACT_TOOL_NAMES.join(", ") : "(none)"}`);
              console.log("");
              console.log("  Error sample:");
              console.log(`    Input  : ${sampleError}`);
              console.log(`    Output : ${_redactError(sampleError)}`);
              console.log("");
              console.log("  Tool name sample:");
              sampleTools.forEach((t) =>
                console.log(`    ${t.padEnd(16)} → ${_redactToolName(t)}`),
              );
            },
          },
          {
            name:        "drain",
            description: "Retry all events in the dead-letter queue",
            async handler() {
              if (_dlq.length === 0) {
                console.log("AgentMetrics drain - DLQ is empty");
                return;
              }
              const count = _dlq.length;
              console.log(`AgentMetrics drain - retrying ${count} DLQ event(s)…`);
              const items = _dlq.splice(0, _dlq.length);
              for (const item of items) {
                item.attempt = 0;
                _queue.push(item);
              }
              while (_queue.length > 0 && !_cbIsOpen()) {
                await _flush();
              }
              console.log(`  Done - sent: ${_metrics.sent}, failed: ${_metrics.failed}, remaining DLQ: ${_dlq.length}`);
            },
          },
          {
            name:        "cost",
            description: "Show pricing table and any custom costProviderTable overrides",
            handler() {
              const builtIn  = Object.keys(_PRICING).length;
              const overrides = Object.keys(COST_PROVIDER_TABLE);
              console.log("AgentMetrics cost - pricing table");
              console.log(`  Built-in models    : ${builtIn}`);
              console.log(`  Custom overrides   : ${overrides.length}`);
              if (overrides.length > 0) {
                console.log("");
                console.log("  Custom rates (USD/M tokens):");
                for (const model of overrides) {
                  const r = COST_PROVIDER_TABLE[model];
                  const cr = r[2] != null ? `  cr=$${r[2].toFixed(3)}` : "";
                  const cw = r[3] != null ? `  cw=$${r[3].toFixed(3)}` : "";
                  console.log(`    ${model.padEnd(30)} in=$${r[0].toFixed(3)}  out=$${r[1].toFixed(3)}${cr}${cw}`);
                }
              }
              console.log("");
              console.log("  Built-in rates (USD/M tokens):");
              for (const [model, r] of Object.entries(_PRICING)) {
                const cr = r[2] != null ? `  cr=$${r[2].toFixed(3)}` : "";
                const cw = r[3] != null ? `  cw=$${r[3].toFixed(3)}` : "";
                const overridden = COST_PROVIDER_TABLE[model] ? " [overridden]" : "";
                console.log(`    ${model.padEnd(30)} in=$${r[0].toFixed(3)}  out=$${r[1].toFixed(3)}${cr}${cw}${overridden}`);
              }
              if (sessions.size > 0) {
                console.log("");
                let totalCost = 0;
                for (const s of sessions.values()) totalCost += s.totalEstimatedCostUsd;
                if (totalCost > 0) {
                  console.log(`  Estimated cost (all active sessions): $${totalCost.toFixed(6)}`);
                }
              }
            },
          },
        ],
      });
    }

    api.on("session_start", (event: HermesSessionStartEvent, ctx: HermesSessionContext) => {
      const key = event.sessionKey ?? event.sessionId;
      if (!key || sessions.has(key)) return;

      sessions.set(key, {
        traceId:     randomUUID(),
        agentId:     ctx.agentId ?? "hermes-agent",
        startedAt:   Date.now(),
        compactions: 0,
        resets:      0,
        runCount:              0,
        totalInputTokens:      0,
        totalOutputTokens:     0,
        totalCacheReadTokens:  0,
        totalCacheWriteTokens: 0,
        totalToolCalls:        0,
        totalEstimatedCostUsd: 0,
        totalDurationMs:       0,
      });
    });

    api.on("run_start", (event: HermesRunStartEvent, ctx: HermesAgentContext) => {
      const sessionKey = event.sessionKey ?? event.sessionId ?? ctx.sessionKey ?? ctx.sessionId;
      const agentId    = event.agentId ?? ctx.agentId ?? "hermes-agent";
      const runId      = event.runId ?? ctx.runId;

      if (!runId) return;

      const run = emptyRun(sessionKey);
      if (event.delegationDepth != null) {
        run.delegationDepth = event.delegationDepth;
      }
      runs.set(runId, run);

      sendActivity("run_start", agentId, sessionKey, runId, {
        delegation_depth: event.delegationDepth ?? ctx.delegationDepth,
      });
    });

    api.on("llm_input", (event: HermesLlmInputEvent, ctx: HermesAgentContext) => {
      const { runId } = event;
      if (!runId) return;

      const sessionKey = event.sessionKey ?? ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      const run        = runs.get(runId) ?? emptyRun(sessionKey);

      run.llmCalls    += 1;
      run.imagesCount += event.imagesCount ?? 0;
      if (!run.model    && event.model)    run.model    = event.model;
      if (!run.provider && event.provider) run.provider = event.provider;
      if (!run.sessionKey) run.sessionKey = sessionKey;
      runs.set(runId, run);

      sendActivity("llm_start", agentId, sessionKey, runId, {
        model:    event.model,
        provider: event.provider,
        images:   event.imagesCount,
        history:  event.historyMessages?.length ?? 0,
      });
    });

    api.on("llm_output", (event: HermesLlmOutputEvent, ctx: HermesAgentContext) => {
      const { runId } = event;
      if (!runId) return;

      const sessionKey = event.sessionKey ?? ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      const run        = runs.get(runId) ?? emptyRun(sessionKey);

      if (event.usage) {
        run.inputTokens      += event.usage.input      ?? 0;
        run.outputTokens     += event.usage.output     ?? 0;
        run.cacheReadTokens  += event.usage.cacheRead  ?? 0;
        run.cacheWriteTokens += event.usage.cacheWrite ?? 0;
      }
      if (event.model)    run.model    = event.model;
      if (event.provider) run.provider = event.provider;
      if (!run.sessionKey) run.sessionKey = sessionKey;
      runs.set(runId, run);

      sendActivity("llm_end", agentId, sessionKey, runId, {
        model:         event.model,
        provider:      event.provider,
        input_tokens:  event.usage?.input,
        output_tokens: event.usage?.output,
        cache_read:    event.usage?.cacheRead,
        cache_write:   event.usage?.cacheWrite,
        total_input:   run.inputTokens,
        total_output:  run.outputTokens,
      });
    });

    api.on("before_tool_call", (event: HermesBeforeToolCallEvent, ctx: HermesToolContext) => {
      const runId      = event.runId ?? ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      sendActivity("tool_start", agentId, sessionKey, runId, {
        tool_name: event.toolName,
      });
    });

    api.on("after_tool_call", (event: HermesAfterToolCallEvent, ctx: HermesToolContext) => {
      const runId      = event.runId ?? ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId) ?? emptyRun(sessionKey);
        run.toolCalls += 1;
        if (event.error) run.toolErrors += 1;
        run.toolNames.add(event.toolName);
        if (!run.sessionKey) run.sessionKey = sessionKey;
        runs.set(runId, run);
      }

      sendActivity("tool_end", agentId, sessionKey, runId, {
        tool_name:   _redactToolName(event.toolName),
        duration_ms: event.durationMs,
        error:       _redactError(event.error, true),
      });
    });

    api.on("subagent_spawn", (event: HermesSubagentSpawnEvent, ctx: HermesSubagentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.parentSessionKey;
      const agentId    = sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId);
        if (run) {
          run.subagentsSpawned += 1;
          if (event.delegationDepth != null && event.delegationDepth > run.delegationDepth) {
            run.delegationDepth = event.delegationDepth;
          }
          runs.set(runId, run);
        }
      }

      sendActivity("subagent_start", agentId, sessionKey, runId, {
        child_agent_id:    event.agentId,
        child_session_key: event.childSessionKey,
        label:             event.label,
        delegation_depth:  event.delegationDepth,
      });
    });

    api.on("subagent_end", (event: HermesSubagentEndEvent, ctx: HermesSubagentContext) => {
      const runId      = event.runId ?? ctx.runId;
      const sessionKey = ctx.parentSessionKey;
      const agentId    = sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId);
        if (run && event.outcome && event.outcome !== "ok") {
          run.subagentErrors += 1;
          runs.set(runId, run);
        }
      }

      sendActivity("subagent_end", agentId, sessionKey, runId, {
        child_session_key: event.targetSessionKey,
        outcome:           event.outcome,
        error:             _redactError(event.error, true),
      });
    });

    api.on("skill_load", (event: HermesSkillLoadEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId);
        if (run) {
          run.skillsLoadedCount += 1;
          run.skillNames.add(event.skillName);
          runs.set(runId, run);
        }
      }

      sendActivity("skill_load", agentId, sessionKey, runId, {
        skill_name: event.skillName,
        version:    event.version,
      });
    });

    api.on("memory_write", (event: HermesMemoryWriteEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId);
        if (run) {
          run.memoryWritesCount += 1;
          runs.set(runId, run);
        }
      }

      sendActivity("memory_write", agentId, sessionKey, runId, {
        key:        event.key,
        value_type: event.valueType,
      });
    });

    api.on("session_search", (event: HermesSessionSearchEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId);
        if (run) {
          run.sessionSearchCalls += 1;
          runs.set(runId, run);
        }
      }

      sendActivity("session_search", agentId, sessionKey, runId, {
        results_count: event.resultsCount,
      });
    });

    api.on("cron_start", (event: HermesCronStartEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId);
        if (run) {
          run.cronjobId = event.cronjobId;
          run.cronRunId = event.cronRunId;
          runs.set(runId, run);
        }
      }

      sendActivity("cron_start", agentId, sessionKey, runId, {
        cronjob_id: event.cronjobId,
        cron_run_id: event.cronRunId,
        schedule:   event.schedule,
      });
    });

    api.on("cron_end", (event: HermesCronEndEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      sendActivity("cron_end", agentId, sessionKey, runId, {
        cronjob_id:  event.cronjobId,
        cron_run_id: event.cronRunId,
        success:     event.success,
        duration_ms: event.durationMs,
        error:       _redactError(event.error, true),
      });
    });

    api.on("gateway_connect", (event: HermesGatewayConnectEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      sendActivity("gateway_connect", agentId, sessionKey, ctx.runId, {
        remote_id: event.remoteId,
        protocol:  event.protocol,
      });
    });

    api.on("gateway_disconnect", (event: HermesGatewayDisconnectEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId);
        if (run) {
          run.gatewayDisconnects += 1;
          runs.set(runId, run);
        }
      }

      sendActivity("gateway_disconnect", agentId, sessionKey, runId, {
        remote_id: event.remoteId,
        reason:    event.reason,
        code:      event.code,
      });
    });

    api.on("gateway_reconnect", (event: HermesGatewayReconnectEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      if (runId) {
        const run = runs.get(runId);
        if (run) {
          run.reconnects += 1;
          runs.set(runId, run);
        }
      }

      sendActivity("gateway_reconnect", agentId, sessionKey, runId, {
        remote_id: event.remoteId,
        attempt:   event.attempt,
      });
    });

    api.on("retry", (event: HermesRetryEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      sendActivity("retry", agentId, sessionKey, ctx.runId, {
        reason:  event.reason,
        attempt: event.attempt,
      });
    });

    api.on("timeout", (event: HermesTimeoutEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      sendActivity("timeout", agentId, sessionKey, ctx.runId, {
        duration_ms: event.durationMs,
      });
    });

    api.on("cancel", (event: HermesCancelEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      sendActivity("cancel", agentId, sessionKey, ctx.runId, {
        reason: event.reason,
      });
    });

    api.on("failure", (event: HermesFailureEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";

      sendActivity("failure", agentId, sessionKey, ctx.runId, {
        error: _redactError(event.error, true),
      });
    });

    api.on("before_compaction", (_event: HermesCompactionEvent, ctx: HermesAgentContext) => {
      const key     = ctx.sessionKey ?? ctx.sessionId;
      const agentId = ctx.agentId ?? sessions.get(key ?? "")?.agentId ?? "hermes-agent";
      if (!key) return;

      const session = sessions.get(key);
      if (session) {
        session.compactions += 1;
        sessions.set(key, session);
      }

      sendActivity("compaction", agentId, key, ctx.runId);
    });

    api.on("before_reset", (event: HermesResetEvent, ctx: HermesAgentContext) => {
      const key     = ctx.sessionKey ?? ctx.sessionId;
      const agentId = ctx.agentId ?? sessions.get(key ?? "")?.agentId ?? "hermes-agent";
      if (!key) return;

      const session = sessions.get(key);
      if (session) {
        session.resets += 1;
        sessions.set(key, session);
      }

      sendActivity("reset", agentId, key, ctx.runId, { reason: event.reason });
    });

    api.on("run_end", (event: HermesRunEndEvent, ctx: HermesAgentContext) => {
      const runId      = event.runId ?? ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      if (!sessionKey || !runId) return;

      const session = sessions.get(sessionKey);
      const run     = runs.get(runId);
      const agentId = ctx.agentId ?? session?.agentId ?? "hermes-agent";

      if (session) session.agentId = agentId;

      const totalTokens =
        (run?.inputTokens      ?? 0) +
        (run?.outputTokens     ?? 0) +
        (run?.cacheReadTokens  ?? 0) +
        (run?.cacheWriteTokens ?? 0);

      const durationMs    = event.durationMs ?? (run ? Date.now() - run.startedAt : undefined);
      const redactedError = _redactError(event.error);

      const estimatedCostUsd = _estimateCost(
        run?.model,
        run?.inputTokens      ?? 0,
        run?.outputTokens     ?? 0,
        run?.cacheReadTokens  ?? 0,
        run?.cacheWriteTokens ?? 0,
      );

      const delegationDepth =
        event.delegationDepth ?? ctx.delegationDepth ?? run?.delegationDepth ?? 0;

      const skillHash = run ? _skillNamesHash(run.skillNames) : undefined;

      if (session) {
        session.runCount              += 1;
        session.totalInputTokens      += run?.inputTokens      ?? 0;
        session.totalOutputTokens     += run?.outputTokens     ?? 0;
        session.totalCacheReadTokens  += run?.cacheReadTokens  ?? 0;
        session.totalCacheWriteTokens += run?.cacheWriteTokens ?? 0;
        session.totalToolCalls        += run?.toolCalls        ?? 0;
        session.totalEstimatedCostUsd += estimatedCostUsd      ?? 0;
        session.totalDurationMs       += durationMs            ?? 0;
      }

      sendActivity("run_end", agentId, sessionKey, runId, {
        status:       event.success ? "success" : "failed",
        duration_ms:  durationMs,
        total_tokens: totalTokens || undefined,
        tool_calls:   run?.toolCalls,
        error:        _redactError(event.error, true),
      });

      send({
        event_id:                 randomUUID(),
        trace_id:                 session?.traceId ?? randomUUID(),
        session_id:               sessionKey,
        run_id:                   runId,
        agent_id:                 agentId,
        platform:                 "hermes",
        event_name:               "agent_end",
        ts:                       Date.now(),
        redaction_policy_version: `v1-${_activeMode()}`,
        status:              event.success ? "success" : "failed",
        duration_ms:         durationMs,
        model:               run?.model,
        model_provider:      run?.provider,
        input_tokens:        run?.inputTokens      ?? 0,
        output_tokens:       run?.outputTokens     ?? 0,
        cache_read_tokens:   run?.cacheReadTokens  ?? 0,
        cache_write_tokens:  run?.cacheWriteTokens ?? 0,
        total_tokens:        totalTokens || undefined,
        tool_calls:          run?.toolCalls  ?? 0,
        tool_errors:         run?.toolErrors ?? 0,
        tool_names:          run ? _redactToolNames([...run.toolNames]) : [],
        step_count:          event.messages?.length,
        ...(estimatedCostUsd != null ? { estimated_cost_usd: estimatedCostUsd } : {}),
        ...(redactedError ? { error: redactedError } : {}),
        // Hermes-specific extensions
        skills_loaded_count:  run?.skillsLoadedCount  ?? 0,
        ...(skillHash ? { skill_names_hash: skillHash } : {}),
        memory_writes_count:  run?.memoryWritesCount  ?? 0,
        session_search_calls: run?.sessionSearchCalls ?? 0,
        delegation_depth:     delegationDepth,
        ...(run?.cronjobId ? { cronjob_id:  run.cronjobId  } : {}),
        ...(run?.cronRunId ? { cron_run_id: run.cronRunId } : {}),
        metadata: {
          llm_calls:           run?.llmCalls          ?? 0,
          images_count:        run?.imagesCount        ?? 0,
          subagents_spawned:   run?.subagentsSpawned   ?? 0,
          subagent_errors:     run?.subagentErrors     ?? 0,
          gateway_disconnects: run?.gatewayDisconnects ?? 0,
          reconnects:          run?.reconnects         ?? 0,
          compactions:         session?.compactions    ?? 0,
          resets:              session?.resets         ?? 0,
        },
      });

      runs.delete(runId);
    });

    api.on("session_end", (event: HermesSessionEndEvent, _ctx: HermesSessionContext) => {
      const key     = event.sessionKey ?? event.sessionId;
      const session = sessions.get(key);

      if (session && session.runCount > 0) {
        const sessionDurationMs = event.durationMs ?? (Date.now() - session.startedAt);
        const totalTokens       =
          session.totalInputTokens + session.totalOutputTokens +
          session.totalCacheReadTokens + session.totalCacheWriteTokens;

        send({
          event_id:                 randomUUID(),
          trace_id:                 session.traceId,
          session_id:               key,
          agent_id:                 session.agentId,
          platform:                 "hermes",
          event_name:               "session_metrics",
          ts:                       Date.now(),
          redaction_policy_version: `v1-${_activeMode()}`,
          status:                   "success",
          duration_ms:              sessionDurationMs,
          input_tokens:             session.totalInputTokens,
          output_tokens:            session.totalOutputTokens,
          cache_read_tokens:        session.totalCacheReadTokens,
          cache_write_tokens:       session.totalCacheWriteTokens,
          total_tokens:             totalTokens || undefined,
          tool_calls:               session.totalToolCalls,
          ...(session.totalEstimatedCostUsd > 0
            ? { estimated_cost_usd: session.totalEstimatedCostUsd }
            : {}),
          metadata: {
            run_count:     session.runCount,
            compactions:   session.compactions,
            resets:        session.resets,
            message_count: event.messageCount,
            reason:        event.reason,
          },
        });
      }

      sessions.delete(key);
    });
  },
};

export default plugin;
