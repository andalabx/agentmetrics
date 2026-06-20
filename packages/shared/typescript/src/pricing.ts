// Per-million-token pricing in USD from official provider documentation.
// Format: model_prefix → [input, output, cache_read?, cache_write?]
// cache_* absent/undefined when the model has no published cache pricing.
//
// Prefix matching: longer keys are checked first (see estimateCost) so
// "gpt-4o-mini" resolves before "gpt-4o" and "gpt-4.1-nano" before "gpt-4.1".
//
// Namespace stripping: "openai/gpt-4o" → "gpt-4o" before lookup, so all
// keys here use the stripped form (no "provider/" prefix).
//
// Sources:
//   Anthropic  : https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
//   OpenAI     : https://openai.com/api/pricing/
//   Google     : https://ai.google.dev/pricing
//   DeepSeek   : https://api-docs.deepseek.com/quick_start/pricing
//   AWS Bedrock: https://aws.amazon.com/bedrock/pricing/

export const MODEL_PRICING: Record<string, [number, number, number?, number?]> = {
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
  "gpt-5.4-pro":                 [30.00, 180.00],
  "gpt-5.4":                     [ 2.50, 15.00,  0.25],
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

// Pre-sorted longest-first so specific prefixes match before shorter ones.
const _SORTED_KEYS = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);

// ── Runtime registry — platforms register their own catalog ──────────────────

type _PriceEntry = [number, number, number?, number?];

let _runtimeRegistry: Record<string, _PriceEntry> = {};
let _sortedRuntime: string[] = [];

export function registerModelPrices(
  catalog: Record<string, { input: number; output: number; cacheRead?: number | null; cacheWrite?: number | null } | _PriceEntry>,
): void {
  for (const [model, pricing] of Object.entries(catalog)) {
    const key = model.toLowerCase();
    if (Array.isArray(pricing)) {
      _runtimeRegistry[key] = pricing as _PriceEntry;
    } else {
      _runtimeRegistry[key] = [
        pricing.input,
        pricing.output,
        pricing.cacheRead ?? undefined,
        pricing.cacheWrite ?? undefined,
      ];
    }
  }
  _sortedRuntime = Object.keys(_runtimeRegistry).sort((a, b) => b.length - a.length);
}

// ── OpenRouter — explicit opt-in, covers all models OR routes ─────────────────

let _openRouterCache: Record<string, _PriceEntry> = {};
let _sortedOpenRouter: string[] = [];

export async function populateFromOpenRouter(
  apiKey: string,
  baseUrl = "https://openrouter.ai",
  timeout = 15_000,
): Promise<number> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/models`;
  let data: { data?: unknown[] };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return 0;
    data = await resp.json() as { data?: unknown[] };
  } catch {
    return 0;
  }

  let loaded = 0;
  for (const m of data.data ?? []) {
    const model = m as Record<string, unknown>;
    const rawId = String(model.id ?? "").toLowerCase();
    if (!rawId) continue;
    const pricing = model.pricing as Record<string, unknown> | undefined;
    const prompt     = pricing?.prompt;
    const completion = pricing?.completion;
    if (prompt == null && completion == null) continue;
    const inPerM  = parseFloat(String(prompt     ?? 0)) * 1_000_000;
    const outPerM = parseFloat(String(completion ?? 0)) * 1_000_000;
    const crRaw = pricing?.cache_read ?? pricing?.cached_prompt ?? pricing?.input_cache_read;
    const cwRaw = pricing?.cache_write ?? pricing?.cache_creation ?? pricing?.input_cache_write;
    const crPerM = crRaw != null ? parseFloat(String(crRaw)) * 1_000_000 : undefined;
    const cwPerM = cwRaw != null ? parseFloat(String(cwRaw)) * 1_000_000 : undefined;
    // Strip namespace so lookups match (estimateCost strips before querying)
    const key = rawId.includes("/") ? rawId.split("/").slice(1).join("/") : rawId;
    _openRouterCache[key] = [inPerM, outPerM, crPerM, cwPerM];
    loaded += 1;
  }
  _sortedOpenRouter = Object.keys(_openRouterCache).sort((a, b) => b.length - a.length);
  return loaded;
}

// ── Core estimation ───────────────────────────────────────────────────────────

export function estimateCost(
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number | undefined {
  if (!model) return undefined;

  let key = model.toLowerCase().trim();

  // Strip provider namespace: "openai/gpt-4o" → "gpt-4o"
  if (key.includes("/")) key = key.split("/").slice(1).join("/");

  function compute(rates: _PriceEntry): number {
    const M = 1_000_000;
    return (
      inputTokens      * rates[0]           / M +
      outputTokens     * rates[1]           / M +
      cacheReadTokens  * (rates[2] ?? 0)    / M +
      cacheWriteTokens * (rates[3] ?? 0)    / M
    );
  }

  // 1. Runtime registry (registered via registerModelPrices())
  for (const prefix of _sortedRuntime) {
    if (key.startsWith(prefix)) return compute(_runtimeRegistry[prefix]);
  }

  // 2. Static table (official docs, pre-sorted by length)
  for (const prefix of _SORTED_KEYS) {
    if (key.startsWith(prefix)) return compute(MODEL_PRICING[prefix]);
  }

  // 3. OpenRouter cache (if populated via populateFromOpenRouter())
  for (const prefix of _sortedOpenRouter) {
    if (key.startsWith(prefix)) return compute(_openRouterCache[prefix]);
  }

  return undefined; // unknown model — no guessing
}
