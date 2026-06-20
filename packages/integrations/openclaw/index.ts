import { randomUUID } from "crypto";
import { join } from "path";
import {
  CB_PROBE_MS,
  _activeMode, _cb, _cbIsOpen, _cfg, _dlq, _estimateCost,
  _flush, _metrics, _queue, _redactError, _redactToolName, _redactToolNames,
  _registerModelPrices, _walInit, send, sendActivity, sessions,
} from "../_shared/core.js";

// OpenClaw-specific model pricing — covers Together AI, Chutes, HuggingFace,
// Arcee extended variants, and Vercel AI Gateway models whose IDs (after
// namespace stripping) are not in the shared static table.
// Keys are lowercase namespace-stripped model IDs (exactly what _estimateCost
// receives after "provider/model-id" → "model-id" normalization).
const _OPENCLAW_CATALOG: Record<string, [number, number, number?, number?]> = {
  // ── Arcee extended ─────────────────────────────────────────────────────────
  "trinity-large-preview":                    [0.25,  1.00,  0.25,  0.25],
  "trinity-large-thinking":                   [0.25,  0.90,  0.25,  0.25],
  // ── Together AI ────────────────────────────────────────────────────────────
  "llama-3.3-70b-instruct-turbo":             [0.88,  0.88,  0.88,  0.88],
  "llama-4-scout-17b-16e-instruct":           [0.18,  0.59,  0.18,  0.18],
  "llama-4-maverick-17b-128e-instruct-fp8":   [0.27,  0.85,  0.27,  0.27],
  "deepseek-v3.1":                            [0.60,  1.25,  0.60,  0.60],
  "kimi-k2.5":                                [0.50,  2.80,  0.50,  2.80],
  "kimi-k2-instruct-0905":                    [1.00,  3.00,  1.00,  3.00],
  "glm-4.7":                                  [0.45,  2.00,  0.45,  2.00],
  // ── Chutes ─────────────────────────────────────────────────────────────────
  "qwen3-32b":                                [0.08,  0.24],
  "qwen3-14b":                                [0.05,  0.22],
  "qwen3-30b-a3b":                            [0.06,  0.22],
  "qwen3-235b-a22b-instruct-2507-tee":        [0.08,  0.55],
  "qwen3-235b-a22b-thinking-2507":            [0.11,  0.60],
  "qwen2.5-72b-instruct":                     [0.30,  1.20],
  "qwen2.5-coder-32b-instruct":               [0.03,  0.11],
  "deepseek-v3-0324-tee":                     [0.25,  1.00],
  "deepseek-v3.1-tee":                        [0.20,  0.80],
  "deepseek-v3.2-tee":                        [0.28,  0.42],
  "deepseek-v3":                              [0.30,  1.20],
  "deepseek-r1-0528-tee":                     [0.45,  2.15],
  "deepseek-r1-distill-llama-70b":            [0.03,  0.11],
  "glm-4.7-tee":                              [0.40,  2.00],
  "glm-4.7-fp8":                              [0.30,  1.20],
  "glm-4.6-tee":                              [0.40,  1.70],
  "glm-4.6-fp8":                              [0.30,  1.20],
  "kimi-k2.5-tee":                            [0.45,  2.20],
  "minimax-m2.5-tee":                         [0.30,  1.10],
  // ── Vercel AI Gateway ──────────────────────────────────────────────────────
  "claude-opus-4.6":                          [5.00,  25.00, 0.50,  6.25],
};

interface PluginApi {
  config:         Record<string, unknown>;
  pluginConfig?:  Record<string, unknown>;
  registerAutoEnableProbe?: (probe: () => boolean) => void;
  registerCli?: (registrar: {
    name:        string;
    description: string;
    commands:    Array<{ name: string; description: string; handler: () => void | Promise<void> }>;
  }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin API accepts any typed handler
  on: (hookName: string, handler: (...args: any[]) => void) => void;
}

type AgentContext = {
  runId?:           string;
  agentId?:         string;
  sessionKey?:      string;
  sessionId?:       string;
  modelId?:         string;
  modelProviderId?: string;
};

type SessionContext = {
  sessionId:   string;
  sessionKey?: string;
  agentId?:    string;
};

type ToolContext = {
  agentId?:    string;
  sessionKey?: string;
  sessionId?:  string;
  runId?:      string;
  toolName:    string;
  toolCallId?: string;
};

type SubagentContext = {
  runId?:               string;
  childSessionKey?:     string;
  requesterSessionKey?: string;
};

type GatewayContext    = { port?: number };

type SessionStartEvent   = { sessionId: string; sessionKey?: string; resumedFrom?: string; };
type SessionEndEvent     = { sessionId: string; sessionKey?: string; durationMs?: number; messageCount: number; reason?: string; transcriptArchived?: boolean; };
type LlmInputEvent       = { runId: string; sessionId: string; provider: string; model: string; systemPrompt?: string; prompt: string; historyMessages: unknown[]; imagesCount: number; };
type LlmOutputEvent      = { runId: string; sessionId: string; provider: string; model: string; assistantTexts: string[]; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number; }; };
type BeforeToolCallEvent = { toolName: string; params: Record<string, unknown>; runId?: string; toolCallId?: string; };
type AfterToolCallEvent  = { toolName: string; params: Record<string, unknown>; runId?: string; toolCallId?: string; result?: unknown; error?: string; durationMs?: number; };
type AgentEndEvent       = { messages: unknown[]; success: boolean; error?: string; durationMs?: number; };
type BeforeAgentStartEvent = { agentId?: string; sessionKey?: string; sessionId?: string; };
type SubagentSpawningEvent = { childSessionKey: string; agentId: string; label?: string; mode: "run" | "session"; threadRequested: boolean; };
type SubagentEndedEvent    = { targetSessionKey: string; reason: string; runId?: string; outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted"; error?: string; };
type CompactionEvent       = { messageCount: number; compactingCount?: number; tokenCount?: number; sessionFile?: string; };
type ResetEvent            = { sessionFile?: string; reason?: string; };
type GatewayStartEvent     = { port: number };
type GatewayStopEvent      = { reason?: string };

interface RunMeta {
  inputTokens:      number;
  outputTokens:     number;
  cacheReadTokens:  number;
  cacheWriteTokens: number;
  llmCalls:         number;
  imagesCount:      number;
  toolCalls:        number;
  toolErrors:       number;
  toolNames:        Set<string>;
  subagentsSpawned: number;
  subagentErrors:   number;
  model?:           string;
  provider?:        string;
  sessionKey?:      string;
  startedAt:        number;
}

const runs = new Map<string, RunMeta>();

function emptyRun(sessionKey?: string): RunMeta {
  return {
    inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    llmCalls: 0, imagesCount: 0,
    toolCalls: 0, toolErrors: 0, toolNames: new Set(),
    subagentsSpawned: 0, subagentErrors: 0,
    sessionKey,
    startedAt: Date.now(),
  };
}

const plugin = {
  id:          "agentmetrics",
  name:        "AgentMetrics",
  description: "360-degree observability for every OpenClaw agent - real-time streaming, tokens, tools, latency, cost, subagents, and reliability.",
  configSchema: {
    type: "object",
    properties: {
      apiKey:               { type: "string",  description: "AgentMetrics API key (overrides AGENTMETRICS_API_KEY env var)" },
      endpoint:             { type: "string",  description: "Custom API endpoint (default: http://localhost:8099)" },
      enabled:              { type: "boolean", description: "Disable the plugin without removing it (default: true)" },
      flushIntervalSeconds: { type: "number",  description: "How often to flush the event queue to the API (default: 10)" },
      maxBatchSize:         { type: "number",  description: "Maximum events per batch request (default: 100)" },
      maxQueueSize:         { type: "number",  description: "Maximum in-memory queue depth before FIFO drop (default: 10000)" },
      retryMaxAttempts:     { type: "number",  description: "Max retry attempts before moving event to DLQ (default: 5)" },
      redactionMode:        { type: "string",  enum: ["strict", "moderate", "debug"], description: "PII redaction level applied to prompts/completions (default: strict)" },
      exportedToolNames:    { type: "string",  enum: ["allowlist", "blocklist", "hash", "off"], description: "Which tool names to include in exports (default: blocklist)" },
      redactToolNames:      { type: "array",   items: { type: "string" }, description: "Tool names to redact when exportedToolNames is 'blocklist'" },
      compressPayloads:     { type: "boolean", description: "Gzip-compress batch payloads larger than 1 KB (default: false)" },
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

    _cfg.enabled            = (api.pluginConfig?.enabled           as boolean | undefined) ?? true;
    _cfg.redactionMode      = (api.pluginConfig?.redactionMode      as typeof _cfg.redactionMode    | undefined) ?? "strict";
    _cfg.exportedToolNames  = (api.pluginConfig?.exportedToolNames   as typeof _cfg.exportedToolNames  | undefined) ?? "blocklist";
    _cfg.redactToolNames    = (api.pluginConfig?.redactToolNames    as string[] | undefined) ?? [];
    _cfg.flushIntervalMs    = ((api.pluginConfig?.flushIntervalSeconds as number | undefined) ?? 10) * 1000;
    _cfg.maxBatchSize       = (api.pluginConfig?.maxBatchSize       as number | undefined) ?? 100;
    _cfg.maxQueueSize       = (api.pluginConfig?.maxQueueSize       as number | undefined) ?? 10_000;
    _cfg.retryMaxAttempts   = (api.pluginConfig?.retryMaxAttempts   as number | undefined) ?? 5;
    _cfg.compressPayloads   = (api.pluginConfig?.compressPayloads   as boolean | undefined) ?? false;

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
    _walInit(join(home, ".config", "openclaw", "agentmetrics-wal.jsonl"));

    // Register OpenClaw-specific model pricing (provider-routed IDs not in
    // the shared static table, e.g. Together AI, Chutes, Vercel AI Gateway).
    _registerModelPrices(_OPENCLAW_CATALOG);

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
              console.log(`  API key          : ${keyPreview}`);
              console.log(`  Endpoint         : ${_cfg.baseUrl}`);
              console.log(`  Redaction        : ${mode}${mode === "debug" && _cfg.debugExpiresAt ? ` (expires ${new Date(_cfg.debugExpiresAt).toLocaleTimeString()})` : ""}`);
              console.log(`  Tool names       : ${_cfg.exportedToolNames}`);
              console.log(`  Compress payloads: ${_cfg.compressPayloads}`);
              console.log(`  Flush interval   : ${_cfg.flushIntervalMs / 1000}s`);
              console.log(`  WAL path         : ${_cfg.walPath ?? "(unavailable)"}`);
              console.log("");
              console.log(`  Circuit breaker  : ${_cb.state}${cbInfo}`);
              console.log(`  Queue depth      : ${_queue.length} / ${_cfg.maxQueueSize}`);
              console.log(`  DLQ depth        : ${_dlq.length}`);
              console.log(`  Sessions tracked : ${sessions.size}`);
              console.log(`  Runs in flight   : ${runs.size}`);
              console.log("");
              console.log(`  Sent             : ${_metrics.sent}`);
              console.log(`  Failed           : ${_metrics.failed}`);
              console.log(`  Dropped (overflow): ${_metrics.dropped}`);
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
            description: "Show recent in-flight run state",
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
                  console.log(`    ${id.slice(0, 12)}… llm=${r.llmCalls} tools=${r.toolCalls} ${age}s elapsed`);
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
                    platform:                 "openclaw",
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
              sampleTools.forEach((t, i) =>
                console.log(`    ${t.padEnd(16)} → ${_redactToolNames(sampleTools)[i]}`),
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
        ],
      });
      /* eslint-enable no-console */
    }

    api.on("gateway_start", (event: GatewayStartEvent, _ctx: GatewayContext) => {
      sendActivity("gateway_start", "openclaw-gateway", undefined, undefined, { port: event.port });
    });

    api.on("gateway_stop", (event: GatewayStopEvent, _ctx: GatewayContext) => {
      sendActivity("gateway_stop", "openclaw-gateway", undefined, undefined, { reason: event.reason });
    });

    api.on("session_start", (event: SessionStartEvent, ctx: SessionContext) => {
      const key = event.sessionKey ?? event.sessionId;
      if (!key || sessions.has(key)) return;
      sessions.set(key, {
        traceId: randomUUID(), agentId: ctx.agentId ?? "openclaw-agent",
        startedAt: Date.now(), compactions: 0, resets: 0,
        runCount: 0, totalInputTokens: 0, totalOutputTokens: 0,
        totalCacheReadTokens: 0, totalCacheWriteTokens: 0,
        totalToolCalls: 0, totalEstimatedCostUsd: 0, totalDurationMs: 0,
      });
    });

    api.on("before_agent_start", (event: BeforeAgentStartEvent, ctx: AgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? "openclaw-agent";
      const runId      = ctx.runId;
      if (!runId && !sessionKey) return;
      sendActivity("run_start", agentId, sessionKey, runId, {
        model: ctx.modelId, provider: ctx.modelProviderId,
      });
    });

    api.on("llm_input", (event: LlmInputEvent, ctx: AgentContext) => {
      const { runId } = event;
      if (!runId) return;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId ?? event.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "openclaw-agent";
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

    api.on("llm_output", (event: LlmOutputEvent, ctx: AgentContext) => {
      const { runId } = event;
      if (!runId) return;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId ?? event.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "openclaw-agent";
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

    api.on("before_tool_call", (event: BeforeToolCallEvent, ctx: ToolContext) => {
      const runId      = event.runId ?? ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "openclaw-agent";
      sendActivity("tool_start", agentId, sessionKey, runId, { tool_name: event.toolName });
    });

    api.on("after_tool_call", (event: AfterToolCallEvent, ctx: ToolContext) => {
      const runId      = event.runId ?? ctx.runId;
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      const agentId    = ctx.agentId ?? sessions.get(sessionKey ?? "")?.agentId ?? "openclaw-agent";
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

    api.on("subagent_spawning", (event: SubagentSpawningEvent, ctx: SubagentContext) => {
      const runId      = ctx.runId;
      const sessionKey = ctx.requesterSessionKey;
      const agentId    = sessions.get(sessionKey ?? "")?.agentId ?? "openclaw-agent";
      if (runId) {
        const run = runs.get(runId);
        if (run) { run.subagentsSpawned += 1; runs.set(runId, run); }
      }
      sendActivity("subagent_start", agentId, sessionKey, runId, {
        child_agent_id: event.agentId, child_session_key: event.childSessionKey,
        mode: event.mode, label: event.label,
      });
    });

    api.on("subagent_ended", (event: SubagentEndedEvent, ctx: SubagentContext) => {
      const runId      = event.runId ?? ctx.runId;
      const sessionKey = ctx.requesterSessionKey;
      const agentId    = sessions.get(sessionKey ?? "")?.agentId ?? "openclaw-agent";
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

    api.on("before_compaction", (_event: CompactionEvent, ctx: AgentContext) => {
      const key     = ctx.sessionKey ?? ctx.sessionId;
      const agentId = ctx.agentId ?? sessions.get(key ?? "")?.agentId ?? "openclaw-agent";
      if (!key) return;
      const session = sessions.get(key);
      if (session) { session.compactions += 1; sessions.set(key, session); }
      sendActivity("compaction", agentId, key, ctx.runId);
    });

    api.on("before_reset", (event: ResetEvent, ctx: AgentContext) => {
      const key     = ctx.sessionKey ?? ctx.sessionId;
      const agentId = ctx.agentId ?? sessions.get(key ?? "")?.agentId ?? "openclaw-agent";
      if (!key) return;
      const session = sessions.get(key);
      if (session) { session.resets += 1; sessions.set(key, session); }
      sendActivity("reset", agentId, key, ctx.runId, { reason: event.reason });
    });

    api.on("agent_end", (event: AgentEndEvent, ctx: AgentContext) => {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId;
      if (!sessionKey) return;

      const session = sessions.get(sessionKey);
      const run     = ctx.runId ? runs.get(ctx.runId) : undefined;
      const agentId = ctx.agentId ?? session?.agentId ?? "openclaw-agent";
      if (session) session.agentId = agentId;

      const totalTokens =
        (run?.inputTokens ?? 0) + (run?.outputTokens ?? 0) +
        (run?.cacheReadTokens ?? 0) + (run?.cacheWriteTokens ?? 0);
      const durationMs       = event.durationMs ?? (run ? Date.now() - run.startedAt : undefined);
      const redactedError    = _redactError(event.error);
      const estimatedCostUsd = _estimateCost(run?.model, run?.inputTokens ?? 0, run?.outputTokens ?? 0, run?.cacheReadTokens ?? 0, run?.cacheWriteTokens ?? 0);

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

      sendActivity("run_end", agentId, sessionKey, ctx.runId, {
        status: event.success ? "success" : "failed",
        duration_ms: durationMs, total_tokens: totalTokens || undefined,
        tool_calls: run?.toolCalls, error: _redactError(event.error, true),
      });

      send({
        event_id:                 randomUUID(),
        trace_id:                 session?.traceId ?? randomUUID(),
        session_id:               sessionKey,
        run_id:                   ctx.runId,
        agent_id:                 agentId,
        platform:                 "openclaw",
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
        metadata: {
          llm_calls:         run?.llmCalls        ?? 0,
          images_count:      run?.imagesCount      ?? 0,
          subagents_spawned: run?.subagentsSpawned ?? 0,
          subagent_errors:   run?.subagentErrors   ?? 0,
          compactions:       session?.compactions  ?? 0,
          resets:            session?.resets       ?? 0,
        },
      });

      if (ctx.runId) runs.delete(ctx.runId);
    });

    api.on("session_end", (event: SessionEndEvent, _ctx: SessionContext) => {
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
          platform:                 "openclaw",
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
