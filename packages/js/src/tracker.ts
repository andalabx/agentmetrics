import { HttpClient } from "./http-client";

// (inputPerM, outputPerM, cacheReadPerM?, cacheWritePerM?) - USD per million tokens
const _PRICING: Record<string, [number, number, number?, number?]> = {
  "claude-opus-4-7":               [15.0,  75.0,  1.50,  18.75],
  "claude-sonnet-4-6":             [3.0,   15.0,  0.30,  3.75],
  "claude-haiku-4-5":              [0.8,   4.0,   0.08,  1.00],
  "claude-haiku-4-5-20251001":     [0.8,   4.0,   0.08,  1.00],
  "claude-3-7-sonnet-20250219":    [3.0,   15.0,  0.30,  3.75],
  "claude-3-5-sonnet-20241022":    [3.0,   15.0,  0.30,  3.75],
  "claude-3-5-haiku-20241022":     [0.8,   4.0,   0.08,  1.00],
  "claude-3-opus-20240229":        [15.0,  75.0,  1.50,  18.75],
  "claude-3-sonnet-20240229":      [3.0,   15.0,  0.30,  3.75],
  "claude-3-haiku-20240307":       [0.25,  1.25,  0.03,  0.30],
  "gpt-4o":                        [2.5,   10.0],
  "gpt-4o-mini":                   [0.15,  0.60],
  "gpt-4-turbo":                   [10.0,  30.0],
  "gpt-4":                         [30.0,  60.0],
  "gpt-3.5-turbo":                 [0.50,  1.50],
  "o1":                            [15.0,  60.0],
  "o1-mini":                       [3.0,   12.0],
  "o3-mini":                       [1.10,  4.40],
  "gemini-2.0-flash":              [0.075, 0.30],
  "gemini-2.0-flash-lite":         [0.075, 0.30],
  "gemini-1.5-pro":                [1.25,  5.00],
  "gemini-1.5-flash":              [0.075, 0.30],
};

function _estimateCost(
  model: string | undefined,
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
): number | undefined {
  if (!model) return undefined;
  let rates = _PRICING[model];
  if (!rates) {
    const key = Object.keys(_PRICING).find((k) => model.startsWith(k));
    if (key) rates = _PRICING[key];
  }
  if (!rates) return undefined;
  const [rIn, rOut, rCr = 0, rCw = 0] = rates;
  return Math.round((
    input      * rIn  / 1_000_000
    + output   * rOut / 1_000_000
    + cacheRead  * rCr  / 1_000_000
    + cacheWrite * rCw  / 1_000_000
  ) * 1e8) / 1e8;
}

export interface AgentMetricsOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Sample rate 0.0-1.0. Default 1.0 (all runs tracked). */
  sampleRate?: number;
  /** Gzip-compress payloads >1 KB before sending. Default false. */
  compress?: boolean;
}

export interface TrackOptions {
  agentId: string;
  metadata?: Record<string, unknown>;
  sampleRate?: number;
}

interface RunContext {
  traceId: string;
  agentId: string;
  steps: StepData[];
  tools: ToolData[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  llmCalls: number;
  scores: Record<string, number>;
  model?: string;
}

interface StepData {
  name: string;
  stepType?: string;
  durationMs: number;
  status: "success" | "failed";
  metadata?: Record<string, unknown>;
}

interface ToolData {
  name: string;
  durationMs: number;
  status: "success" | "failed";
  metadata?: Record<string, unknown>;
}

type ALS = {
  getStore: () => RunContext | undefined;
  run: (ctx: RunContext, fn: () => unknown) => unknown;
};

let _als: ALS | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ah = require("async_hooks") as {
    AsyncLocalStorage: new <T>() => {
      getStore: () => T | undefined;
      run: (ctx: T, fn: () => unknown) => unknown;
    };
  };
  _als = new ah.AsyncLocalStorage<RunContext>();
} catch {
  // Not Node.js -- use fallback
}

const _stack: RunContext[] = [];

function _getCtx(): RunContext | undefined {
  return _als ? _als.getStore() : _stack.at(-1);
}

function _runInCtx<T>(ctx: RunContext, fn: () => T): T {
  if (_als) return _als.run(ctx, fn) as T;
  _stack.push(ctx);
  try {
    return fn();
  } finally {
    _stack.pop();
  }
}

const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 2000;

class BatchSender {
  private _queue: Record<string, unknown>[] = [];
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly client: HttpClient) {}

  enqueue(event: Record<string, unknown>): void {
    this._queue.push(event);
    if (this._queue.length >= BATCH_SIZE) {
      this._flush();
      return;
    }
    if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), FLUSH_INTERVAL_MS);
    }
  }

  private _flush(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._queue.length) return;
    const batch = this._queue.splice(0);
    this.client.fireAndForgetBatch(batch);
  }

  async drain(): Promise<void> {
    this._flush();
    await this.client.flush();
    if (this._queue.length > 0) {
      this._flush();
      await this.client.flush();
    }
  }
}

function _randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for Node.js < 19 and non-browser environments
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function _roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

export class AgentMetrics {
  private _client: HttpClient | null = null;
  private _batcher: BatchSender | null = null;
  private _sampleRate = 1.0;
  private _instrumented = false;

  /**
   * Call once at startup.
   * @example
   * agentmetrics.configure({ apiKey: "am_your_key" });
   * agentmetrics.instrument(); // optional: auto-capture OpenAI / Anthropic tokens
   */
  configure(options: AgentMetricsOptions): void {
    if (this._client !== null) {
      console.warn("agentmetrics: configure() called more than once; overwriting previous configuration");
    }
    this._sampleRate = options.sampleRate ?? 1.0;
    this._client = new HttpClient({
      apiKey: options.apiKey ?? "",
      baseUrl: options.baseUrl ?? "http://localhost:8099",
      compress: options.compress ?? false,
    });
    this._batcher = new BatchSender(this._client);
  }

  get isConfigured(): boolean {
    return this._client !== null;
  }

  instrument(): void {
    if (this._instrumented) return;
    this._instrumented = true;
    this._patchOpenAI();
    this._patchAnthropic();
  }

  private _patchOpenAI(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("openai") as {
        OpenAI?: { prototype: Record<string, unknown> };
        default?: { prototype: Record<string, unknown> };
      };
      const Cls = mod.OpenAI ?? mod.default;
      if (!Cls) return;
      const chat = Cls.prototype["chat"] as { completions?: { create?: unknown } } | undefined;
      const orig = chat?.completions?.create as ((...a: unknown[]) => Promise<unknown>) | undefined;
      if (!orig || !chat?.completions) return;
      chat.completions.create = async function (...args: unknown[]) {
        const req = args[0] as { model?: string; stream?: boolean } | undefined;
        if (req?.stream) return orig.apply(this, args);
        const ctx = _getCtx();
        const result = await orig.apply(this, args);
        if (ctx) {
          const res = result as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
          ctx.inputTokens += res.usage?.prompt_tokens ?? 0;
          ctx.outputTokens += res.usage?.completion_tokens ?? 0;
          ctx.llmCalls += 1;
          if (!ctx.model && req?.model) ctx.model = req.model;
        }
        return result;
      };
    } catch { /* openai not installed */ }
  }

  private _patchAnthropic(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("@anthropic-ai/sdk") as {
        Anthropic?: { prototype: Record<string, unknown> };
        default?: { prototype: Record<string, unknown> };
      };
      const Cls = mod.Anthropic ?? mod.default;
      if (!Cls) return;
      const messages = Cls.prototype["messages"] as { create?: unknown } | undefined;
      const orig = messages?.create as ((...a: unknown[]) => Promise<unknown>) | undefined;
      if (!orig || !messages) return;
      messages.create = async function (...args: unknown[]) {
        const req = args[0] as { model?: string; stream?: boolean } | undefined;
        if (req?.stream) return orig.apply(this, args);
        const ctx = _getCtx();
        const result = await orig.apply(this, args);
        if (ctx) {
          const res = result as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
          ctx.inputTokens += res.usage?.input_tokens ?? 0;
          ctx.outputTokens += res.usage?.output_tokens ?? 0;
          ctx.cacheReadTokens += res.usage?.cache_read_input_tokens ?? 0;
          ctx.cacheWriteTokens += res.usage?.cache_creation_input_tokens ?? 0;
          ctx.llmCalls += 1;
          if (!ctx.model && req?.model) ctx.model = req.model;
        }
        return result;
      };
    } catch { /* @anthropic-ai/sdk not installed */ }
  }

  score(name: string, value: number): void {
    const ctx = _getCtx();
    if (!ctx) {
      console.warn(`agentmetrics: score() called outside a tracked function; score "${name}" ignored`);
      return;
    }
    ctx.scores[name] = value;
  }

  async step<T>(
    name: string,
    fn: () => T | Promise<T>,
    options?: { stepType?: string; metadata?: Record<string, unknown> }
  ): Promise<T> {
    const start = performance.now();
    const ctx = _getCtx();
    let status: "success" | "failed" = "success";
    try {
      return await fn();
    } catch (err) {
      status = "failed";
      throw err;
    } finally {
      if (ctx) {
        ctx.steps.push({
          name,
          stepType: options?.stepType,
          durationMs: performance.now() - start,
          status,
          metadata: options?.metadata,
        });
      }
    }
  }

  async tool<T>(
    name: string,
    fn: () => T | Promise<T>,
    options?: { metadata?: Record<string, unknown> }
  ): Promise<T> {
    const start = performance.now();
    const ctx = _getCtx();
    let status: "success" | "failed" = "success";
    try {
      return await fn();
    } catch (err) {
      status = "failed";
      throw err;
    } finally {
      if (ctx) {
        ctx.tools.push({
          name,
          durationMs: performance.now() - start,
          status,
          metadata: options?.metadata,
        });
      }
    }
  }

  track<T extends (...args: unknown[]) => unknown>(
    agentIdOrOptions: string | TrackOptions,
    fn: T
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
    const opts: TrackOptions =
      typeof agentIdOrOptions === "string"
        ? { agentId: agentIdOrOptions }
        : agentIdOrOptions;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return async function (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
      if (!self.isConfigured) {
        console.warn(`agentmetrics: configure() was not called before tracking agent "${opts.agentId}". Call agentmetrics.configure() at startup.`);
        return (await fn(...args)) as Awaited<ReturnType<T>>;
      }
      const effectiveRate = opts.sampleRate ?? self._sampleRate;
      if (Math.random() > effectiveRate) {
        return (await fn(...args)) as Awaited<ReturnType<T>>;
      }
      const parentCtx = _getCtx();
      const ctx: RunContext = {
        traceId: _randomUUID(),
        agentId: opts.agentId,
        steps: [],
        tools: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        llmCalls: 0,
        scores: {},
        model: undefined,
      };
      const start = performance.now();
      let status: "success" | "failed" = "success";
      let errorMsg: string | null = null;
      try {
        return (await _runInCtx(ctx, () => fn(...args))) as Awaited<ReturnType<T>>;
      } catch (err) {
        status = "failed";
        errorMsg = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const durationMs = _roundMs(performance.now() - start);
        const toolNames = [...new Set(ctx.tools.map((t) => t.name))];
        const toolErrors = ctx.tools.filter((t) => t.status === "failed").length;
        const event: Record<string, unknown> = {
          // v2 identity fields
          event_id:                 _randomUUID(),
          trace_id:                 ctx.traceId,
          agent_id:                 ctx.agentId,
          platform:                 "javascript",
          event_name:               "agent_end",
          ts:                       Date.now(),
          redaction_policy_version: "v1-strict",
          // run data
          status,
          duration_ms:  durationMs,
          error:        errorMsg,
          step_count:   ctx.steps.length,
          tool_calls:   ctx.tools.length,
          tool_errors:  toolErrors,
          tool_names:   toolNames,
        };
        if (parentCtx) event["parent_trace_id"] = parentCtx.traceId;
        if (ctx.model) event["model"] = ctx.model;
        if (ctx.inputTokens) event["input_tokens"] = ctx.inputTokens;
        if (ctx.outputTokens) event["output_tokens"] = ctx.outputTokens;
        if (ctx.cacheReadTokens) event["cache_read_tokens"] = ctx.cacheReadTokens;
        if (ctx.cacheWriteTokens) event["cache_write_tokens"] = ctx.cacheWriteTokens;
        if (ctx.llmCalls) event["llm_calls"] = ctx.llmCalls;
        const est = _estimateCost(ctx.model, ctx.inputTokens, ctx.outputTokens, ctx.cacheReadTokens, ctx.cacheWriteTokens);
        if (est !== undefined) event["estimated_cost_usd"] = est;
        const meta: Record<string, unknown> = { ...(opts.metadata ?? {}) };
        if (ctx.steps.length) {
          meta["steps"] = ctx.steps.map((s) => ({
            name: s.name,
            ...(s.stepType && { step_type: s.stepType }),
            duration_ms: _roundMs(s.durationMs),
            status: s.status,
            ...(s.metadata && { metadata: s.metadata }),
          }));
        }
        if (ctx.tools.length) {
          meta["tool_calls_detail"] = ctx.tools.map((t) => ({
            name: t.name,
            duration_ms: _roundMs(t.durationMs),
            status: t.status,
            ...(t.metadata && { metadata: t.metadata }),
          }));
        }
        if (Object.keys(ctx.scores).length) meta["scores"] = ctx.scores;
        if (Object.keys(meta).length) event["metadata"] = meta;
        self._enqueue(event);
      }
    };
  }

  /** Returns the current trace ID from inside a tracked function. */
  get traceId(): string | undefined {
    return _getCtx()?.traceId;
  }

  private _enqueue(event: Record<string, unknown>): void {
    if (this._batcher) this._batcher.enqueue(event);
  }

  /** Flush all buffered events. Call before process.exit(). */
  async flush(): Promise<void> {
    if (this._batcher) await this._batcher.drain();
  }
}

/** Module-level singleton. */
export const agentmetrics = new AgentMetrics();
