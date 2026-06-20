import { randomUUID } from "crypto";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { LLMResult } from "@langchain/core/outputs";
import type { ChainValues } from "@langchain/core/utils/types";
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


interface RunState {
  agentId:          string;
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

function newRunState(agentId: string): RunState {
  return {
    agentId,
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


export class AgentMetricsCallback extends BaseCallbackHandler {
  name = "agentmetrics";

  private readonly _apiKey:   string;
  private readonly _agentId:  string;
  private readonly _baseUrl:  string;

  // top-level run_id → RunState
  private readonly _runs      = new Map<string, RunState>();
  // run_id → parent run_id (ancestry chain)
  private readonly _parentMap = new Map<string, string>();
  // tool run_id → tool name (resolved on end/error)
  private readonly _pendingToolNames = new Map<string, string>();

  constructor(opts: {
    apiKey:   string;
    agentId?: string;
    baseUrl?: string;
  }) {
    super();
    this._apiKey  = opts.apiKey;
    this._agentId = opts.agentId ?? "langchain-agent";
    this._baseUrl = opts.baseUrl ?? "http://localhost:8099";
  }


  async handleChainStart(
    _serialized: Serialized,
    _inputs: ChainValues,
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    if (!parentRunId) {
      this._runs.set(runId, newRunState(this._agentId));
    } else {
      this._parentMap.set(runId, parentRunId);
    }
  }

  async handleChainEnd(
    _outputs: ChainValues,
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    if (!parentRunId) {
      await this._emit(runId);
    }
  }

  async handleChainError(
    err: Error,
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    if (!parentRunId) {
      const run = this._runs.get(runId);
      if (run) {
        run.status = "failed";
        run.error  = String(err).slice(0, 500);
      }
      await this._emit(runId);
    }
  }


  async handleLLMStart(
    _llm: Serialized,
    _prompts: string[],
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    if (parentRunId) this._parentMap.set(runId, parentRunId);
  }

  async handleChatModelStart(
    _llm: Serialized,
    _messages: unknown[][],
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    if (parentRunId) this._parentMap.set(runId, parentRunId);
  }

  async handleLLMEnd(
    output: LLMResult,
    runId: string,
  ): Promise<void> {
    const run = this._findTopRun(runId);
    if (!run) return;
    run.llmCalls++;

    // Path 1: ChatGeneration → message.usage_metadata (Anthropic / OpenAI)
    let foundUsage = false;
    for (const genList of output.generations) {
      for (const gen of genList) {
        const msg   = (gen as any).message;
        const umeta = msg?.usage_metadata as Record<string, any> | undefined;
        if (umeta) {
          run.inputTokens       += (umeta["input_tokens"]  as number | null) ?? 0;
          run.outputTokens      += (umeta["output_tokens"] as number | null) ?? 0;
          const details = (umeta["input_token_details"] as Record<string, number> | null) ?? {};
          run.cacheReadTokens   += details["cache_read"]     ?? 0;
          run.cacheWriteTokens  += details["cache_creation"] ?? 0;
          if (!run.model) {
            const rmeta = msg?.response_metadata as Record<string, string> | undefined;
            run.model = rmeta?.["model_name"] ?? rmeta?.["model"] ?? null;
          }
          foundUsage = true;
        }
      }
    }
    if (foundUsage) return;

    // Path 2: llm_output dict (older/non-chat)
    const lo    = (output.llmOutput ?? {}) as Record<string, any>;
    const usage = (lo["token_usage"] ?? lo["usage"] ?? {}) as Record<string, number>;
    run.inputTokens       += usage["prompt_tokens"]              ?? 0;
    run.outputTokens      += usage["completion_tokens"]          ?? 0;
    run.cacheReadTokens   += usage["cache_read_input_tokens"]    ?? 0;
    run.cacheWriteTokens  += usage["cache_creation_input_tokens"] ?? 0;
    if (!run.model) {
      run.model = lo["model_name"] ?? lo["model"] ?? null;
    }
  }

  async handleLLMError(_err: Error, _runId: string): Promise<void> {
    // LLM errors do not affect tool error counts
  }


  async handleToolStart(
    serialized: Serialized,
    _input: string,
    runId: string,
    parentRunId?: string,
  ): Promise<void> {
    const name = (serialized as any).name
      ?? ((serialized as any).id as string[] | undefined)?.at(-1)
      ?? "unknown";
    this._pendingToolNames.set(runId, String(name));
    if (parentRunId) this._parentMap.set(runId, parentRunId);
  }

  async handleToolEnd(
    _output: unknown,
    runId: string,
  ): Promise<void> {
    const run = this._findTopRun(runId);
    if (run) {
      run.toolCalls++;
      const name = this._pendingToolNames.get(runId);
      if (name) run.toolNames.add(name);
    }
    this._pendingToolNames.delete(runId);
  }

  async handleToolError(err: Error, runId: string): Promise<void> {
    const run = this._findTopRun(runId);
    if (run) {
      run.toolCalls++;
      run.toolErrors++;
      const name = this._pendingToolNames.get(runId);
      if (name) run.toolNames.add(name);
    }
    this._pendingToolNames.delete(runId);
  }


  private _findTopRun(runId: string): RunState | null {
    const seen = new Set<string>();
    let rid: string | undefined = runId;
    while (rid && !seen.has(rid)) {
      seen.add(rid);
      const state = this._runs.get(rid);
      if (state) return state;
      rid = this._parentMap.get(rid);
    }
    return null;
  }

  private async _emit(runId: string): Promise<void> {
    const run = this._runs.get(runId);
    if (!run) return;
    this._runs.delete(runId);

    // clean up orphan parent-map entries
    for (const [k, v] of this._parentMap) {
      if (v === runId) this._parentMap.delete(k);
    }

    const durationMs = performance.now() - run.startMs;
    const est = sharedEstimateCost(
      run.model ?? undefined,
      run.inputTokens,
      run.outputTokens,
      run.cacheReadTokens,
      run.cacheWriteTokens,
    );

    const payload: AgentEndEvent = {
      event_id:                 randomUUID(),
      trace_id:                 runId,
      agent_id:                 run.agentId,
      platform:                 "langchain",
      event_name:               "agent_end",
      ts:                       Date.now(),
      redaction_policy_version: "v1-strict",
      status:      run.status,
      duration_ms: Math.round(durationMs * 100) / 100,
      tool_calls:  run.toolCalls,
      tool_errors: run.toolErrors,
      tool_names:  [...run.toolNames],
      llm_calls:   run.llmCalls,
      input_tokens:  run.inputTokens,
      output_tokens: run.outputTokens,
      ...(run.model            ? { model:              run.model            } : {}),
      ...(run.error            ? { error:              run.error            } : {}),
      ...(run.cacheReadTokens  ? { cache_read_tokens:  run.cacheReadTokens  } : {}),
      ...(run.cacheWriteTokens ? { cache_write_tokens: run.cacheWriteTokens } : {}),
      ...(est != null          ? { estimated_cost_usd: est                  } : {}),
    };

    // fire-and-forget: don't block the caller
    sendWithRetry(this._baseUrl, this._apiKey, payload).catch(() => {});
  }
}
