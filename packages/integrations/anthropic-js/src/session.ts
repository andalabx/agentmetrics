import { randomUUID } from "crypto";
import type { AgentEndEvent } from "@agentmetrics/core";
import { estimateCost as sharedEstimateCost } from "@agentmetrics/core";


const MAX_RETRY_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendWithRetry(
  url: string,
  apiKey: string,
  payload: object,
): Promise<void> {
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${url}/v1/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      });
      if (res.ok || (res.status >= 400 && res.status < 500)) return;
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await sleep(Math.min(1000 * 2 ** attempt + Math.random() * 200, 10_000));
      }
    } catch {
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await sleep(Math.min(1000 * 2 ** attempt + Math.random() * 200, 10_000));
      }
    }
  }
}


interface SessionState {
  agentId:          string;
  sessionId:        string;
  startMs:          number;
  inputTokens:      number;
  outputTokens:     number;
  cacheReadTokens:  number;
  cacheWriteTokens: number;
  llmCalls:         number;
  toolCalls:        number;
  toolErrors:       number;
  toolNames:        Set<string>;
  model:            string | null;
  status:           "success" | "failed";
  error:            string | null;
}

function newSessionState(agentId: string, sessionId: string): SessionState {
  return {
    agentId,
    sessionId,
    startMs:          performance.now(),
    inputTokens:      0,
    outputTokens:     0,
    cacheReadTokens:  0,
    cacheWriteTokens: 0,
    llmCalls:         0,
    toolCalls:        0,
    toolErrors:       0,
    toolNames:        new Set(),
    model:            null,
    status:           "success",
    error:            null,
  };
}

function processEvent(state: SessionState, event: Record<string, unknown>): boolean {
  const etype = (event["type"] as string | undefined) ?? "";

  if (etype === "span.model_request_end") {
    const usage = (event["usage"] as Record<string, number> | null) ?? {};
    state.inputTokens       += usage["input_tokens"]              ?? 0;
    state.outputTokens      += usage["output_tokens"]             ?? 0;
    state.cacheReadTokens   += usage["cache_read_input_tokens"]   ?? 0;
    state.cacheWriteTokens  += usage["cache_creation_input_tokens"] ?? 0;
    if (!state.model && event["model"]) {
      state.model = event["model"] as string;
    }
    state.llmCalls++;

  } else if (
    etype === "agent.tool_use" ||
    etype === "agent.mcp_tool_use" ||
    etype === "agent.custom_tool_use"
  ) {
    state.toolCalls++;
    const name = (event["tool_name"] ?? event["name"]) as string | undefined;
    if (name) state.toolNames.add(name);

  } else if (etype === "agent.tool_result") {
    const content = event["content"] as Record<string, unknown> | null;
    if (content?.["is_error"]) state.toolErrors++;

  } else if (etype === "session.error") {
    state.status = "failed";
    state.error  = String(event["error"] ?? "").slice(0, 500) || null;

  } else if (etype === "session.status_terminated") {
    return true;
  }

  return false;
}

async function emit(
  baseUrl: string,
  apiKey: string,
  state: SessionState,
): Promise<void> {
  const durationMs = performance.now() - state.startMs;
  const est = sharedEstimateCost(
    state.model ?? undefined,
    state.inputTokens,
    state.outputTokens,
    state.cacheReadTokens,
    state.cacheWriteTokens,
  );

  const payload: AgentEndEvent = {
    event_id:                 randomUUID(),
    trace_id:                 state.sessionId,
    agent_id:                 state.agentId,
    platform:                 "anthropic",
    event_name:               "agent_end",
    ts:                       Date.now(),
    redaction_policy_version: "v1-strict",
    status:      state.status,
    duration_ms: Math.round(durationMs * 100) / 100,
    tool_calls:  state.toolCalls,
    tool_errors: state.toolErrors,
    tool_names:  [...state.toolNames],
    llm_calls:   state.llmCalls,
    input_tokens:  state.inputTokens,
    output_tokens: state.outputTokens,
    ...(state.model            ? { model:              state.model            } : {}),
    ...(state.error            ? { error:              state.error            } : {}),
    ...(state.cacheReadTokens  ? { cache_read_tokens:  state.cacheReadTokens  } : {}),
    ...(state.cacheWriteTokens ? { cache_write_tokens: state.cacheWriteTokens } : {}),
    ...(est != null            ? { estimated_cost_usd: est                    } : {}),
  };

  sendWithRetry(baseUrl, apiKey, payload).catch(() => {});
}


/**
 * Wraps a Claude Managed Agents session stream and tracks observability data.
 *
 * Usage (async iterator)::
 *
 *   import { AgentMetricsSessionTracker } from "agentmetrics-anthropic";
 *
 *   const tracker = new AgentMetricsSessionTracker({ apiKey: "am_..." });
 *
 *   await tracker.track(client, sessionId, async (stream) => {
 *     for await (const event of stream) {
 *       // handle events as normal
 *     }
 *   });
 *
 * Or wrapping an existing stream::
 *
 *   const rawStream = client.beta.sessions.events.stream(sessionId);
 *   const tracked   = tracker.wrap(rawStream, sessionId);
 *   for await (const event of tracked) { ... }
 */
export class AgentMetricsSessionTracker {
  private readonly _apiKey:  string;
  private readonly _agentId: string;
  private readonly _baseUrl: string;

  constructor(opts: {
    apiKey:   string;
    agentId?: string;
    baseUrl?: string;
  }) {
    this._apiKey  = opts.apiKey;
    this._agentId = opts.agentId ?? "anthropic-agent";
    this._baseUrl = opts.baseUrl ?? "http://localhost:8099";
  }

  /**
   * Wraps any async iterable of session events with tracking.
   * Emits metrics when `session.status_terminated` is received or the
   * iterator exhausts.
   */
  wrap(
    rawStream: AsyncIterable<Record<string, unknown>>,
    sessionId: string,
  ): AsyncIterable<Record<string, unknown>> {
    const state   = newSessionState(this._agentId, sessionId);
    const baseUrl = this._baseUrl;
    const apiKey  = this._apiKey;

    return {
      [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
        const iter = rawStream[Symbol.asyncIterator]();
        let done = false;
        return {
          async next() {
            if (done) return { value: undefined, done: true };
            const result = await iter.next();
            if (result.done) {
              if (!done) {
                done = true;
                await emit(baseUrl, apiKey, state);
              }
              return { value: undefined, done: true };
            }
            const event = result.value;
            const terminated = processEvent(state, event);
            if (terminated) {
              done = true;
              await emit(baseUrl, apiKey, state);
            }
            return { value: event, done: false };
          },
          async return(value) {
            if (!done) {
              done = true;
              state.status = "failed";
              state.error  = "stream cancelled";
              await emit(baseUrl, apiKey, state);
            }
            return iter.return ? iter.return(value) : { value, done: true };
          },
        };
      },
    };
  }

  /**
   * Higher-level helper: opens a session event stream, wraps it with
   * tracking, and passes the tracked stream to your callback.
   *
   * @param client     - Anthropic SDK client (with beta.sessions.events.stream)
   * @param sessionId  - The session ID to stream events for
   * @param fn         - Async callback receiving the tracked stream
   */
  async track<T>(
    client: {
      beta: {
        sessions: {
          events: {
            stream(sessionId: string, ...args: unknown[]): AsyncIterable<Record<string, unknown>>;
          };
        };
      };
    },
    sessionId: string,
    fn: (stream: AsyncIterable<Record<string, unknown>>) => Promise<T>,
    ...streamArgs: unknown[]
  ): Promise<T> {
    const state   = newSessionState(this._agentId, sessionId);
    const baseUrl = this._baseUrl;
    const apiKey  = this._apiKey;
    let emitted   = false;

    const rawStream = client.beta.sessions.events.stream(sessionId, ...streamArgs);

    const trackedStream: AsyncIterable<Record<string, unknown>> = {
      [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
        const iter = rawStream[Symbol.asyncIterator]();
        let done = false;
        return {
          async next() {
            if (done) return { value: undefined, done: true };
            const result = await iter.next();
            if (result.done) {
              done = true;
              return { value: undefined, done: true };
            }
            const event = result.value;
            const terminated = processEvent(state, event);
            if (terminated) done = true;
            return { value: event, done: false };
          },
        };
      },
    };

    try {
      const result = await fn(trackedStream);
      if (!emitted) {
        emitted = true;
        await emit(baseUrl, apiKey, state);
      }
      return result;
    } catch (err) {
      if (!emitted) {
        emitted = true;
        state.status = "failed";
        state.error  = String(err).slice(0, 500);
        await emit(baseUrl, apiKey, state);
      }
      throw err;
    }
  }
}
