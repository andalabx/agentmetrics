const MAX_ERROR_LEN = 500;

function sanitizeError(msg: unknown): string {
  const s = msg instanceof Error ? msg.message : String(msg ?? "");
  return s.length > MAX_ERROR_LEN ? s.slice(0, MAX_ERROR_LEN) + "…" : s;
}

function backoff(attempt: number, base = 1000, cap = 16000): number {
  return Math.random() * Math.min(cap, base * 2 ** attempt);
}

function _tryGzip(data: string): { body: BodyInit; encoding?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const zlib = require("zlib") as { gzipSync: (buf: Buffer) => Buffer };
    const compressed = zlib.gzipSync(Buffer.from(data));
    return { body: compressed, encoding: "gzip" };
  } catch {
    return { body: data };
  }
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly compress: boolean;
  private pending: Promise<void>[] = [];

  constructor(options: { apiKey: string; baseUrl: string; compress?: boolean }) {
    this.apiKey = options.apiKey;
    // Normalise: strip trailing slash and any /v1 suffix so callers can pass
    // either "http://localhost:8099" or "http://localhost:8099/v1"
    // and the versioned path is always constructed here.
    this.baseUrl = options.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    this.compress = options.compress ?? false;
  }

  fireAndForget(payload: Record<string, unknown>): void {
    const safe = payload["error"] != null
      ? { ...payload, error: sanitizeError(payload["error"]) }
      : payload;
    this._track(this._post(`${this.baseUrl}/v1/events`, safe));
  }

  fireAndForgetBatch(events: Record<string, unknown>[]): void {
    if (!events.length) return;
    const safe = events.map((e) =>
      e["error"] != null
        ? { ...e, error: sanitizeError(e["error"]) }
        : e
    );
    this._track(this._post(`${this.baseUrl}/v1/events/batch`, { events: safe }));
  }

  private _track(p: Promise<void>): void {
    const tracked = p.catch(() => {});
    this.pending.push(tracked);
    void tracked.finally(() => {
      this.pending = this.pending.filter((x) => x !== tracked);
    });
  }

  private async _post(
    url: string,
    payload: Record<string, unknown>,
    retries = 3
  ): Promise<void> {
    const raw = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    let body: BodyInit = raw;
    if (this.compress && raw.length > 1024) {
      const { body: compressed, encoding } = _tryGzip(raw);
      body = compressed;
      if (encoding) headers["Content-Encoding"] = encoding;
    }
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) return;
      } catch {
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, backoff(attempt)));
        }
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }
}
