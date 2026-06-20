import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { dirname } from "path";

// ── Mutable config ────────────────────────────────────────────────────────────

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

// ── WAL with AES-256-GCM encryption ──────────────────────────────────────────

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

// ── Circuit breaker functions ─────────────────────────────────────────────────

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
