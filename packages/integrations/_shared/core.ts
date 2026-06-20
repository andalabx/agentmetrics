// Shared delivery core for agentmetrics-hermes and agentmetrics-openclaw plugins.
// Bundled into each plugin's dist/ at build time — never published standalone.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { dirname } from "path";

// ── Pure utilities ────────────────────────────────────────────────────────────

export function _hashName(name: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h ^ name.charCodeAt(i), 0x01000193)) >>> 0;
  }
  return `t_${h.toString(16).padStart(8, "0")}`;
}

export const _SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9\-_]{20,}/g,
  /am_[A-Za-z0-9\-_]{16,}/g,
  /\bey[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}/g,
  /(?:api[_\-]?key|apikey|api[_\-]?token|access[_\-]?token|secret|password|passwd|auth)[=:\s"']+([^\s"'&,\]}\n]{8,})/gi,
];

export function _scrubSecrets(str: string): string {
  let out = str;
  for (const re of _SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

export const _PRICING: Record<string, [number, number, number?, number?]> = {
  // ── Anthropic ──────────────────────────────────────────────────────────────
  "claude-opus-4":               [15.00, 75.00,  1.50, 18.75],
  "claude-sonnet-4":             [ 3.00, 15.00,  0.30,  3.75],
  "claude-haiku-4":              [ 0.80,  4.00,  0.08,  1.00],
  "claude-3-7-sonnet":           [ 3.00, 15.00,  0.30,  3.75],
  "claude-3-5-sonnet":           [ 3.00, 15.00,  0.30,  3.75],
  "claude-3-5-haiku":            [ 0.80,  4.00,  0.08,  1.00],
  "claude-3-opus":               [15.00, 75.00,  1.50, 18.75],
  "claude-3-haiku":              [ 0.25,  1.25,  0.03,  0.30],
  "claude-3-sonnet":             [ 3.00, 15.00],
  // ── OpenAI ─────────────────────────────────────────────────────────────────
  "gpt-4.1-nano":                [ 0.10,  0.40,  0.025],
  "gpt-4.1-mini":                [ 0.40,  1.60,  0.10],
  "gpt-4.1":                     [ 2.00,  8.00,  0.50],
  "gpt-4o-mini":                 [ 0.15,  0.60,  0.075],
  "gpt-4o":                      [ 2.50, 10.00,  1.25],
  "gpt-4-turbo":                 [10.00, 30.00],
  "gpt-4":                       [30.00, 60.00],
  "gpt-3.5-turbo":               [ 0.50,  1.50],
  "o3-mini":                     [ 1.10,  4.40,  0.55],
  "o3":                          [10.00, 40.00,  2.50],
  "o1-mini":                     [ 1.10,  4.40,  0.55],
  "o1":                          [15.00, 60.00,  7.50],
  // ── Google Gemini ──────────────────────────────────────────────────────────
  "gemini-2.5-pro":              [ 1.25, 10.00],
  "gemini-2.5-flash":            [ 0.15,  0.60],
  "gemini-2.0-flash":            [ 0.10,  0.40],
  "gemini-1.5-pro":              [ 1.25,  5.00],
  "gemini-1.5-flash":            [ 0.075, 0.30],
  // ── DeepSeek ───────────────────────────────────────────────────────────────
  "deepseek-reasoner":           [ 0.55,  2.19],
  "deepseek-chat":               [ 0.14,  0.28],
  "deepseek-coder":              [ 0.14,  0.28],
  // ── Meta / Llama (namespace-stripped prefix keys) ──────────────────────────
  "llama-4-maverick":            [ 0.27,  0.85],
  "llama-4-scout":               [ 0.18,  0.59],
  "llama-3.3-70b":               [ 0.88,  0.88],
  "llama-3-70b":                 [ 0.65,  2.75],
  "llama-3-8b":                  [ 0.05,  0.20],
  // ── Alibaba / Qwen ─────────────────────────────────────────────────────────
  "qwen3-235b":                  [ 4.00, 16.00],
  "qwen3-32b":                   [ 0.30,  1.20],
  "qwen3-4b":                    [ 0.02,  0.08],
  // ── Arcee ──────────────────────────────────────────────────────────────────
  "trinity-large":               [ 0.25,  1.00,  0.25,  0.25],
  "trinity-mini":                [ 0.045, 0.15,  0.045, 0.045],
  // ── Together AI / HuggingFace (namespace-stripped prefix keys) ─────────────
  "kimi-k2":                     [ 0.50,  2.80],
  "deepseek-v3":                 [ 0.60,  1.25],
  "deepseek-r1":                 [ 3.00,  7.00],
  // ── Vercel AI Gateway ──────────────────────────────────────────────────────
  "gpt-5.4-pro":                 [30.00, 180.00],
  "gpt-5.4":                     [ 2.50, 15.00,  0.25],
  // ── AWS Bedrock ────────────────────────────────────────────────────────────
  "anthropic.claude-opus-4":     [15.00, 75.00],
  "anthropic.claude-sonnet-4":   [ 3.00, 15.00],
  "anthropic.claude-haiku-4":    [ 0.80,  4.00],
  "anthropic.claude-3-5-sonnet": [ 3.00, 15.00],
  "anthropic.claude-3-5-haiku":  [ 0.80,  4.00],
  "amazon.nova-pro":             [ 0.80,  3.20],
  "amazon.nova-lite":            [ 0.06,  0.24],
  "amazon.nova-micro":           [ 0.035, 0.14],
};

// ── Mutable config (mutated by each plugin's register()) ─────────────────────

export const _cfg = {
  apiKey:            undefined as string | undefined,
  baseUrl:           "http://localhost:8099",
  enabled:           true,
  redactionMode:     "strict"    as "strict" | "moderate" | "debug",
  exportedToolNames: "blocklist" as "allowlist" | "blocklist" | "hash" | "off",
  redactToolNames:   [] as string[],
  debugExpiresAt:    null as number | null,
  flushIntervalMs:   10_000,
  maxBatchSize:      100,
  maxQueueSize:      10_000,
  retryMaxAttempts:  5,
  compressPayloads:  false,
  costProviderTable: {} as Record<string, [number, number, number?, number?]>,
  walPath:           null as string | null,
  flushTimer:        null as ReturnType<typeof setInterval> | null,
  registered:        false,
};

// ── Delivery state ────────────────────────────────────────────────────────────

export const _metrics = { sent: 0, failed: 0, dropped: 0 };

export interface QueuedEvent {
  payload:    Record<string, unknown>;
  attempt:    number;
  enqueuedAt: number;
}
export const _queue: QueuedEvent[] = [];
export const _dlq:   QueuedEvent[] = [];

// ── Circuit breaker ───────────────────────────────────────────────────────────

export const CB_THRESHOLD = 10;
export const CB_PROBE_MS  = 5 * 60_000;
export type CbState = "closed" | "open" | "half-open";
export const _cb = {
  state:       "closed" as CbState,
  consecFails: 0,
  openAt:      null as number | null,
};

// ── Session aggregates ────────────────────────────────────────────────────────

export interface SessionMeta {
  traceId:               string;
  agentId:               string;
  startedAt:             number;
  compactions:           number;
  resets:                number;
  runCount:              number;
  totalInputTokens:      number;
  totalOutputTokens:     number;
  totalCacheReadTokens:  number;
  totalCacheWriteTokens: number;
  totalToolCalls:        number;
  totalEstimatedCostUsd: number;
  totalDurationMs:       number;
}
export const sessions = new Map<string, SessionMeta>();

// ── WAL with AES-256-GCM encryption (M9) ─────────────────────────────────────

function _walKey(): Buffer | null {
  if (!_cfg.apiKey) return null;
  return createHash("sha256").update(_cfg.apiKey).digest();
}

export function _walAppend(payload: Record<string, unknown>): void {
  if (!_cfg.walPath) return;
  try {
    const key = _walKey();
    let line: string;
    if (key) {
      const iv      = randomBytes(12);
      const cipher  = createCipheriv("aes-256-gcm", key, iv);
      const enc     = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
      line = JSON.stringify({
        iv:   iv.toString("base64"),
        tag:  cipher.getAuthTag().toString("base64"),
        data: enc.toString("base64"),
      });
    } else {
      line = JSON.stringify(payload);
    }
    appendFileSync(_cfg.walPath, line + "\n", "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console -- WAL failure notifies the operator without crashing the agent
    console.warn(`AgentMetrics: WAL append failed - ${err instanceof Error ? err.message : String(err)}`);
  }
}

function _walDecryptLine(line: string): Record<string, unknown> | null {
  const key = _walKey();
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (key && typeof parsed.iv === "string" && typeof parsed.tag === "string" && typeof parsed.data === "string") {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
      decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
      const dec = Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]);
      return JSON.parse(dec.toString("utf8")) as Record<string, unknown>;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function _walCompact(sentIds: Set<string>): void {
  if (!_cfg.walPath || !existsSync(_cfg.walPath)) return;
  try {
    const lines = readFileSync(_cfg.walPath, "utf8").split("\n").filter(Boolean);
    const kept  = lines.filter((line) => {
      const ev = _walDecryptLine(line);
      return ev !== null && !sentIds.has(String(ev.event_id ?? ""));
    });
    writeFileSync(_cfg.walPath, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console -- WAL compact failure notifies the operator
    console.warn(`AgentMetrics: WAL compact failed - ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function _walRecover(): void {
  if (!_cfg.walPath || !existsSync(_cfg.walPath)) return;
  try {
    const lines = readFileSync(_cfg.walPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const payload = _walDecryptLine(line);
      if (payload) _enqueue(payload, true);
    }
    if (lines.length > 0) {
      // eslint-disable-next-line no-console -- startup recovery count informs the user how many events were replayed
      console.log(`AgentMetrics: recovered ${lines.length} event(s) from WAL`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console -- WAL recovery failure notifies the operator
    console.warn(`AgentMetrics: WAL recovery failed - ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function _walInit(walFilePath: string): void {
  try {
    mkdirSync(dirname(walFilePath), { recursive: true });
    try { chmodSync(dirname(walFilePath), 0o700); } catch { /* best-effort */ }
    _cfg.walPath = walFilePath;
    _walRecover();
  } catch {
    _cfg.walPath = null;
  }
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export function _enqueue(payload: Record<string, unknown>, fromWal = false): void {
  if (_queue.length >= _cfg.maxQueueSize) {
    _queue.shift();
    _metrics.dropped += 1;
  }
  _queue.push({ payload, attempt: 0, enqueuedAt: Date.now() });
  if (!fromWal) _walAppend(payload);
}

// ── Circuit breaker ───────────────────────────────────────────────────────────

export function _cbIsOpen(): boolean {
  if (_cb.state === "closed") return false;
  if (_cb.state === "open") {
    if (_cb.openAt !== null && Date.now() - _cb.openAt >= CB_PROBE_MS) {
      _cb.state = "half-open";
      return false;
    }
    return true;
  }
  return false;
}

export function _cbOnSuccess(): void {
  if (_cb.state !== "closed") {
    // eslint-disable-next-line no-console -- state transition informs operators that delivery has resumed
    console.log("AgentMetrics: circuit breaker closed - delivery resumed");
  }
  _cb.state       = "closed";
  _cb.consecFails = 0;
  _cb.openAt      = null;
}

export function _cbOnFailure(): void {
  _cb.consecFails += 1;
  if (_cb.state === "half-open" || _cb.consecFails >= CB_THRESHOLD) {
    _cb.state  = "open";
    _cb.openAt = Date.now();
    // eslint-disable-next-line no-console -- circuit breaker opening is a critical delivery failure operators must see
    console.log(
      `AgentMetrics: circuit breaker opened after ${_cb.consecFails} consecutive failures - ` +
      `probing again in ${CB_PROBE_MS / 60_000}min`,
    );
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

export function _buildHeaders(): Record<string, string> {
  return {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${_cfg.apiKey}`,
  };
}

export function _maybeGzip(body: string): { body: string | Uint8Array; extra: Record<string, string> } {
  if (_cfg.compressPayloads && body.length > 1024) {
    try {
      return {
        body:  gzipSync(Buffer.from(body, "utf8")),
        extra: { "Content-Encoding": "gzip" },
      };
    } catch { /* fall through */ }
  }
  return { body, extra: {} };
}

export function _requeue(batch: QueuedEvent[]): void {
  for (const item of batch) {
    item.attempt    += 1;
    _metrics.failed += 1;
    if (item.attempt >= _cfg.retryMaxAttempts) {
      _dlq.push(item);
    } else {
      _queue.push(item);
    }
  }
}

export async function _flushBatch(batch: QueuedEvent[]): Promise<void> {
  const rawBody         = JSON.stringify({ events: batch.map((e) => e.payload) });
  const { body, extra } = _maybeGzip(rawBody);
  try {
    const resp = await fetch(`${_cfg.baseUrl}/v1/events/batch`, {
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

export async function _flushIndividual(batch: QueuedEvent[]): Promise<void> {
  for (const item of batch) {
    const rawBody         = JSON.stringify(item.payload);
    const { body, extra } = _maybeGzip(rawBody);
    try {
      const resp = await fetch(`${_cfg.baseUrl}/v1/events`, {
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

export async function _flush(): Promise<void> {
  if (!_cfg.apiKey || _queue.length === 0 || _cbIsOpen()) return;
  const batch = _queue.splice(0, _cfg.maxBatchSize);
  await _flushBatch(batch);
}

// ── Event senders ─────────────────────────────────────────────────────────────

export function send(payload: Record<string, unknown>): void {
  if (!_cfg.apiKey || !_cfg.enabled) return;
  _enqueue(payload);
}

export function sendActivity(
  type:       string,
  agentId:    string,
  sessionKey: string | undefined,
  runId:      string | undefined,
  data?:      Record<string, unknown>,
): void {
  if (!_cfg.apiKey || !_cfg.enabled) return;
  const payload = JSON.stringify({
    type,
    agent_id:    agentId,
    session_key: sessionKey,
    run_id:      runId,
    ts:          Date.now(),
    data:        data ?? null,
  });
  fetch(`${_cfg.baseUrl}/v1/activity`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${_cfg.apiKey}`,
    },
    body: payload,
  }).catch(() => {});
}

// ── Redaction ─────────────────────────────────────────────────────────────────

export function _activeMode(): "strict" | "moderate" | "debug" {
  if (_cfg.debugExpiresAt !== null) {
    if (Date.now() < _cfg.debugExpiresAt) return "debug";
    _cfg.debugExpiresAt = null;
    // eslint-disable-next-line no-console -- debug mode expiry is a security-relevant event operators must see
    console.log("AgentMetrics: debug mode expired - reverting to strict redaction");
  }
  return _cfg.redactionMode;
}

export function _redactError(err: string | undefined, activityStream = false): string | undefined {
  if (!err) return err;
  const mode   = _activeMode();
  if (mode === "debug") return err;
  const maxLen = (mode === "strict" || activityStream) ? 200 : 500;
  return _scrubSecrets(err).slice(0, maxLen);
}

export function _redactToolName(name: string): string {
  const mode = _activeMode();
  if (mode === "debug") return name;
  switch (_cfg.exportedToolNames) {
    case "off":       return "[REDACTED]";
    case "hash":      return _hashName(name);
    case "allowlist": return _cfg.redactToolNames.includes(name) ? name : `[REDACTED:${_hashName(name)}]`;
    case "blocklist":
    default:          return _cfg.redactToolNames.includes(name) ? `[REDACTED:${_hashName(name)}]` : name;
  }
}

export function _redactToolNames(names: string[]): string[] {
  return names.map(_redactToolName);
}

// ── Cost estimation ───────────────────────────────────────────────────────────

// Pre-sorted longest-first so "gpt-4o-mini" matches before "gpt-4o", etc.
const _PRICING_KEYS = Object.keys(_PRICING).sort((a, b) => b.length - a.length);

export function _estimateCost(
  model:      string | undefined,
  input:      number,
  output:     number,
  cacheRead:  number,
  cacheWrite: number,
): number | undefined {
  if (!model) return undefined;

  let key = model.toLowerCase().trim();
  // Strip provider namespace: "openai/gpt-4o" → "gpt-4o"
  if (key.includes("/")) key = key.split("/").slice(1).join("/");

  // Check user overrides first (also longest-first)
  const overrideKeys = Object.keys(_cfg.costProviderTable).sort((a, b) => b.length - a.length);
  for (const prefix of overrideKeys) {
    if (key.startsWith(prefix.toLowerCase())) {
      const r = _cfg.costProviderTable[prefix];
      const M = 1_000_000;
      return input * r[0] / M + output * r[1] / M + cacheRead * (r[2] ?? 0) / M + cacheWrite * (r[3] ?? 0) / M;
    }
  }

  // Check built-in table
  for (const prefix of _PRICING_KEYS) {
    if (key.startsWith(prefix)) {
      const r = _PRICING[prefix];
      const M = 1_000_000;
      return input * r[0] / M + output * r[1] / M + cacheRead * (r[2] ?? 0) / M + cacheWrite * (r[3] ?? 0) / M;
    }
  }

  return undefined; // unknown model — no guessing
}

export function _registerModelPrices(
  catalog: Record<string, [number, number, number?, number?]>,
): void {
  for (const model of Object.keys(catalog)) {
    if (!Object.prototype.hasOwnProperty.call(catalog, model)) continue;
    _cfg.costProviderTable[model.toLowerCase()] = catalog[model];
  }
}
