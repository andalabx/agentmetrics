import { createHash, randomUUID } from "crypto";
import { join } from "path";
import {
  CB_PROBE_MS, _PRICING,
  _activeMode, _cb, _cbIsOpen, _cfg, _dlq, _estimateCost,
  _flush, _metrics, _queue, _redactError, _redactToolName, _redactToolNames,
  _walInit, send, sendActivity, sessions,
} from "../_shared/core.js";

interface PluginApi {
  config:        Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  registerAutoEnableProbe?: (probe: () => boolean) => void;
  registerCli?: (registrar: {
    name:        string;
    description: string;
    commands:    Array<{ name: string; description: string; handler: () => void | Promise<void> }>;
  }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin API accepts any typed handler
  on: (hookName: string, handler: (...args: any[]) => void) => void;
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

type HermesSessionStartEvent   = { sessionId: string; sessionKey?: string; resumedFrom?: string; };
type HermesSessionEndEvent     = { sessionId: string; sessionKey?: string; durationMs?: number; messageCount?: number; reason?: string; };
type HermesRunStartEvent       = { runId: string; sessionKey?: string; sessionId?: string; agentId?: string; delegationDepth?: number; };
type HermesRunEndEvent         = { runId: string; success: boolean; error?: string; durationMs?: number; messages?: unknown[]; delegationDepth?: number; };
type HermesLlmInputEvent       = { runId: string; sessionKey?: string; provider: string; model: string; systemPrompt?: string; prompt: string; historyMessages?: unknown[]; imagesCount?: number; };
type HermesLlmOutputEvent      = { runId: string; sessionKey?: string; provider: string; model: string; assistantTexts?: string[]; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; }; };
type HermesBeforeToolCallEvent = { toolName: string; params?: Record<string, unknown>; runId?: string; toolCallId?: string; };
type HermesAfterToolCallEvent  = { toolName: string; params?: Record<string, unknown>; runId?: string; toolCallId?: string; result?: unknown; error?: string; durationMs?: number; };
type HermesSubagentSpawnEvent  = { childSessionKey: string; agentId: string; label?: string; delegationDepth?: number; };
type HermesSubagentEndEvent    = { targetSessionKey: string; runId?: string; outcome?: "ok" | "error" | "timeout" | "killed"; error?: string; };
type HermesSkillLoadEvent      = { skillName: string; version?: string; };
type HermesMemoryWriteEvent    = { key: string; valueType?: string; };
type HermesSessionSearchEvent  = { query?: string; resultsCount?: number; };
type HermesCronStartEvent      = { cronjobId: string; cronRunId: string; schedule?: string; };
type HermesCronEndEvent        = { cronjobId: string; cronRunId: string; success: boolean; error?: string; durationMs?: number; };
type HermesGatewayConnectEvent    = { remoteId?: string; protocol?: string; };
type HermesGatewayDisconnectEvent = { remoteId?: string; reason?: string; code?: number; };
type HermesGatewayReconnectEvent  = { remoteId?: string; attempt?: number; };
type HermesRetryEvent   = { reason?: string; attempt?: number; };
type HermesTimeoutEvent = { durationMs?: number; };
type HermesCancelEvent  = { reason?: string; };
type HermesFailureEvent = { error?: string; };
type HermesCompactionEvent = { messageCount?: number; tokenCount?: number; };
type HermesResetEvent      = { reason?: string; };

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

const runs = new Map<string, RunMeta>();

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

function _skillNamesHash(names: Set<string>): string | undefined {
  if (names.size === 0) return undefined;
  return createHash("sha256").update(JSON.stringify([...names].sort())).digest("hex");
}

const plugin = {
  id:          "agentmetrics",
  name:        "AgentMetrics",
  description: "360-degree observability for every Hermes agent - skills, memory, cron jobs, gateway events, tokens, tools, latency, cost, subagents, and reliability.",
  configSchema: {
    type: "object",
    properties: {
      apiKey:            { type: "string",  description: "AgentMetrics API key (overrides AGENTMETRICS_API_KEY env var)" },
      endpoint:          { type: "string",  description: "Custom API endpoint (default: http://localhost:8099)" },
      enabled:           { type: "boolean", description: "Disable the plugin without removing it (default: true)" },
      flushInterval:     { type: "number",  description: "How often to flush the event queue to the API in seconds (default: 10)" },
      batchSize:         { type: "number",  description: "Maximum events per batch request (default: 100)" },
      queueSize:         { type: "number",  description: "Maximum in-memory queue depth before FIFO drop (default: 10000)" },
      retryMaxAttempts:  { type: "number",  description: "Max retry attempts before moving event to DLQ (default: 5)" },
      redactionMode:     { type: "string",  enum: ["strict", "moderate", "debug"], description: "PII redaction level applied to prompts/completions (default: strict)" },
      exportedToolNames: { type: "string",  enum: ["allowlist", "blocklist", "hash", "off"], description: "Which tool names to include in exports (default: blocklist)" },
      redactToolNames:   { type: "array",   items: { type: "string" }, description: "Tool names to redact when exportedToolNames is 'blocklist'" },
      compressPayloads:  { type: "boolean", description: "Gzip-compress batch payloads larger than 1 KB (default: false)" },
      costProviderTable: { type: "object",  description: "Custom per-model pricing overrides (USD per million tokens).", additionalProperties: { type: "array", items: { type: "number" } } },
    },
    additionalProperties: false,
  } as const,

  register(api: PluginApi) {
    if (_cfg.registered) {
      // eslint-disable-next-line no-console -- duplicate registration is an operator-visible misconfiguration warning
      console.warn(
        "\n  AgentMetrics: ⚠ register() called twice - possible duplicate instrumentation.\n" +
        "  If you have both the plugin and an SDK hook active, remove one to avoid\n" +
        "  double-counting runs and inflated token/cost totals.\n",
      );
    }
    _cfg.registered = true;

    _cfg.apiKey  = (api.pluginConfig?.apiKey  as string | undefined) ?? process.env.AGENTMETRICS_API_KEY;
    _cfg.baseUrl = (
      (api.pluginConfig?.endpoint as string | undefined) ??
      process.env.AGENTMETRICS_URL ??
      "http://localhost:8099"
    ).replace(/\/$/, "");

    _cfg.enabled            = (api.pluginConfig?.enabled          as boolean | undefined) ?? true;
    _cfg.redactionMode      = (api.pluginConfig?.redactionMode     as typeof _cfg.redactionMode    | undefined) ?? "strict";
    _cfg.exportedToolNames  = (api.pluginConfig?.exportedToolNames as typeof _cfg.exportedToolNames | undefined) ?? "blocklist";
    _cfg.redactToolNames    = (api.pluginConfig?.redactToolNames   as string[] | undefined) ?? [];
    _cfg.flushIntervalMs    = ((api.pluginConfig?.flushInterval    as number | undefined) ?? 10) * 1000;
    _cfg.maxBatchSize       = (api.pluginConfig?.batchSize         as number | undefined) ?? 100;
    _cfg.maxQueueSize       = (api.pluginConfig?.queueSize         as number | undefined) ?? 10_000;
    _cfg.retryMaxAttempts   = (api.pluginConfig?.retryMaxAttempts  as number | undefined) ?? 5;
    _cfg.compressPayloads   = (api.pluginConfig?.compressPayloads  as boolean | undefined) ?? false;
    _cfg.costProviderTable  = (api.pluginConfig?.costProviderTable as typeof _cfg.costProviderTable | undefined) ?? {};

    if (_cfg.redactionMode === "debug") {
      _cfg.debugExpiresAt = Date.now() + 60 * 60 * 1000;
      // eslint-disable-next-line no-console -- security-relevant: debug mode exposes unredacted data
      console.log("AgentMetrics: ⚠ debug redaction mode active - expires in 1 hour");
    }

    if (typeof api.registerAutoEnableProbe === "function") {
      api.registerAutoEnableProbe(() => !!_cfg.apiKey && _cfg.enabled);
    }

    if (!_cfg.enabled) {
      // eslint-disable-next-line no-console -- startup status must be visible to the developer
      console.log("\n  AgentMetrics: disabled via config (metrics.enabled: false)\n");
      return;
    }

    if (!_cfg.apiKey) {
      // eslint-disable-next-line no-console -- startup status must be visible to the developer
      console.log(
        "\n  AgentMetrics: no API key found.\n" +
        "  Your agent runs are not being tracked.\n" +
        "  Start AgentMetrics (see README) and set AGENTMETRICS_API_KEY.\n" +
        "  AGENTMETRICS_URL defaults to http://localhost:8099.\n",
      );
      return;
    }

    const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
    _walInit(join(home, ".config", "hermes", "agentmetrics-wal.jsonl"));

    if (_cfg.flushTimer) clearInterval(_cfg.flushTimer);
    _cfg.flushTimer = setInterval(() => { _flush().catch(() => {}); }, _cfg.flushIntervalMs);
    if (typeof (_cfg.flushTimer as unknown as { unref?: () => void }).unref === "function") {
      (_cfg.flushTimer as unknown as { unref: () => void }).unref();
    }

    // eslint-disable-next-line no-console -- startup confirmation must be visible to the developer
    console.log(
      `\n  AgentMetrics active - sending data to ${_cfg.baseUrl}\n` +
      `  Queue: max ${_cfg.maxQueueSize} events, batch ${_cfg.maxBatchSize}, flush every ${_cfg.flushIntervalMs / 1000}s\n` +
      `  View your dashboard → http://localhost:3099\n`,
    );

    if (typeof api.registerCli === "function") {
      /* eslint-disable no-console -- CLI command handlers write directly to the terminal */
      api.registerCli({
        name:        "agentmetrics",
        description: "AgentMetrics observability commands",
        commands: [
          {
            name:        "status",
            description: "Show current plugin status, config, delivery counters, and circuit breaker state",
            handler() {
              const keyPreview = _cfg.apiKey
                ? `${_cfg.apiKey.slice(0, 8)}...${_cfg.apiKey.slice(-4)}`
                : "(not set)";
              const mode   = _activeMode();
              const cbInfo = _cb.state === "open" && _cb.openAt
                ? ` (opens probe at ${new Date(_cb.openAt + CB_PROBE_MS).toLocaleTimeString()})`
                : "";
              console.log("AgentMetrics - status");
              console.log(`  API key            : ${keyPreview}`);
              console.log(`  Endpoint           : ${_cfg.baseUrl}`);
              console.log(`  Redaction          : ${mode}${mode === "debug" && _cfg.debugExpiresAt ? ` (expires ${new Date(_cfg.debugExpiresAt).toLocaleTimeString()})` : ""}`);
              console.log(`  Tool names         : ${_cfg.exportedToolNames}`);
              console.log(`  Compress payloads  : ${_cfg.compressPayloads}`);
              console.log(`  Flush interval     : ${_cfg.flushIntervalMs / 1000}s`);
              console.log(`  WAL path           : ${_cfg.walPath ?? "(unavailable)"}`);
              console.log(`  Cost overrides     : ${Object.keys(_cfg.costProviderTable).length} model(s)`);
              console.log("");
              console.log(`  Circuit breaker    : ${_cb.state}${cbInfo}`);
              console.log(`  Queue depth        : ${_queue.length} / ${_cfg.maxQueueSize}`);
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
                console.log(`AgentMetrics flush - circuit breaker is ${_cb.state}, skipping`);
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
              if (!_cfg.apiKey) {
                console.log("AgentMetrics test - no API key set, cannot send");
                return;
              }
              console.log(`AgentMetrics test - sending to ${_cfg.baseUrl}…`);
              try {
                const resp = await fetch(`${_cfg.baseUrl}/v1/events`, {
                  method: "POST",
                  headers: {
                    "Content-Type":  "application/json",
                    "Authorization": `Bearer ${_cfg.apiKey}`,
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
              console.log(`  Tool export   : ${_cfg.exportedToolNames}`);
              console.log(`  Blocked names : ${_cfg.redactToolNames.length ? _cfg.redactToolNames.join(", ") : "(none)"}`);
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
              const builtIn   = Object.keys(_PRICING).length;
              const overrides = Object.keys(_cfg.costProviderTable);
              console.log("AgentMetrics cost - pricing table");
              console.log(`  Built-in models    : ${builtIn}`);
              console.log(`  Custom overrides   : ${overrides.length}`);
              if (overrides.length > 0) {
                console.log("");
                console.log("  Custom rates (USD/M tokens):");
                for (const model of overrides) {
                  const r  = _cfg.costProviderTable[model];
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
                const overridden = _cfg.costProviderTable[model] ? " [overridden]" : "";
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
      /* eslint-enable no-console */
    }

    api.on("session_start", (event: HermesSessionStartEvent, ctx: HermesSessionContext) => {
      const key = event.sessionKey ?? event.sessionId;
      if (!key || sessions.has(key)) return;
      sessions.set(key, {
        traceId: randomUUID(), agentId: ctx.agentId ?? "hermes-agent",
        startedAt: Date.now(), compactions: 0, resets: 0,
        runCount: 0, totalInputTokens: 0, totalOutputTokens: 0,
        totalCacheReadTokens: 0, totalCacheWriteTokens: 0,
        totalToolCalls: 0, totalEstimatedCostUsd: 0, totalDurationMs: 0,
      });
    });

    api.on("run_start", (event: HermesRunStartEvent, ctx: HermesAgentContext) => {
      const sessionKey = event.sessionKey ?? event.sessionId ?? ctx.sessionKey ?? ctx.sessionId;
      const agentId    = event.agentId ?? ctx.agentId ?? "hermes-agent";
      const runId      = event.runId ?? ctx.runId;
      if (!runId) return;
      const run = emptyRun(sessionKey);
      if (event.delegationDepth != null) run.delegationDepth = event.delegationDepth;
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
        model: event.model, provider: event.provider,
        images: event.imagesCount, history: event.historyMessages?.length ?? 0,
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
        model: event.model, provider: event.provider,
        input_tokens: event.usage?.input, output_tokens: event.usage?.output,
        cache_read: event.usage?.cacheRead, cache_write: event.usage?.cacheWrite,
        total_input: run.inputTokens, total_output: run.outputTokens,
      });
    });

    api.on("before_tool_call", (event: HermesBeforeToolCallEvent, ctx: HermesToolContext) => {
      const runId      = event.runId ?? ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      sendActivity("tool_start", agentId, sessionKey, runId, { tool_name: event.toolName });
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
        tool_name: _redactToolName(event.toolName),
        duration_ms: event.durationMs, error: _redactError(event.error, true),
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
        child_agent_id: event.agentId, child_session_key: event.childSessionKey,
        label: event.label, delegation_depth: event.delegationDepth,
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
        outcome: event.outcome, error: _redactError(event.error, true),
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
        skill_name: event.skillName, version: event.version,
      });
    });

    api.on("memory_write", (event: HermesMemoryWriteEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      if (runId) {
        const run = runs.get(runId);
        if (run) { run.memoryWritesCount += 1; runs.set(runId, run); }
      }
      sendActivity("memory_write", agentId, sessionKey, runId, {
        key: event.key, value_type: event.valueType,
      });
    });

    api.on("session_search", (event: HermesSessionSearchEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      if (runId) {
        const run = runs.get(runId);
        if (run) { run.sessionSearchCalls += 1; runs.set(runId, run); }
      }
      sendActivity("session_search", agentId, sessionKey, runId, { results_count: event.resultsCount });
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
        cronjob_id: event.cronjobId, cron_run_id: event.cronRunId, schedule: event.schedule,
      });
    });

    api.on("cron_end", (event: HermesCronEndEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      sendActivity("cron_end", agentId, sessionKey, runId, {
        cronjob_id: event.cronjobId, cron_run_id: event.cronRunId,
        success: event.success, duration_ms: event.durationMs,
        error: _redactError(event.error, true),
      });
    });

    api.on("gateway_connect", (event: HermesGatewayConnectEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      sendActivity("gateway_connect", agentId, sessionKey, ctx.runId, {
        remote_id: event.remoteId, protocol: event.protocol,
      });
    });

    api.on("gateway_disconnect", (event: HermesGatewayDisconnectEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      if (runId) {
        const run = runs.get(runId);
        if (run) { run.gatewayDisconnects += 1; runs.set(runId, run); }
      }
      sendActivity("gateway_disconnect", agentId, sessionKey, runId, {
        remote_id: event.remoteId, reason: event.reason, code: event.code,
      });
    });

    api.on("gateway_reconnect", (event: HermesGatewayReconnectEvent, ctx: HermesAgentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      if (runId) {
        const run = runs.get(runId);
        if (run) { run.reconnects += 1; runs.set(runId, run); }
      }
      sendActivity("gateway_reconnect", agentId, sessionKey, runId, {
        remote_id: event.remoteId, attempt: event.attempt,
      });
    });

    api.on("retry", (event: HermesRetryEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      sendActivity("retry", agentId, sessionKey, ctx.runId, {
        reason: event.reason, attempt: event.attempt,
      });
    });

    api.on("timeout", (event: HermesTimeoutEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      sendActivity("timeout", agentId, sessionKey, ctx.runId, { duration_ms: event.durationMs });
    });

    api.on("cancel", (event: HermesCancelEvent, ctx: HermesAgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "hermes-agent";
      sendActivity("cancel", agentId, sessionKey, ctx.runId, { reason: event.reason });
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
      if (session) { session.compactions += 1; sessions.set(key, session); }
      sendActivity("compaction", agentId, key, ctx.runId);
    });

    api.on("before_reset", (event: HermesResetEvent, ctx: HermesAgentContext) => {
      const key     = ctx.sessionKey ?? ctx.sessionId;
      const agentId = ctx.agentId ?? sessions.get(key ?? "")?.agentId ?? "hermes-agent";
      if (!key) return;
      const session = sessions.get(key);
      if (session) { session.resets += 1; sessions.set(key, session); }
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
        (run?.inputTokens ?? 0) + (run?.outputTokens ?? 0) +
        (run?.cacheReadTokens ?? 0) + (run?.cacheWriteTokens ?? 0);
      const durationMs       = event.durationMs ?? (run ? Date.now() - run.startedAt : undefined);
      const redactedError    = _redactError(event.error);
      const estimatedCostUsd = _estimateCost(run?.model, run?.inputTokens ?? 0, run?.outputTokens ?? 0, run?.cacheReadTokens ?? 0, run?.cacheWriteTokens ?? 0);
      const delegationDepth  = event.delegationDepth ?? ctx.delegationDepth ?? run?.delegationDepth ?? 0;
      const skillHash        = run ? _skillNamesHash(run.skillNames) : undefined;

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
        status: event.success ? "success" : "failed",
        duration_ms: durationMs, total_tokens: totalTokens || undefined,
        tool_calls: run?.toolCalls, error: _redactError(event.error, true),
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
          ...(session.totalEstimatedCostUsd > 0 ? { estimated_cost_usd: session.totalEstimatedCostUsd } : {}),
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
