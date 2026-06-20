from __future__ import annotations

import json
import logging
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

# ── Types ─────────────────────────────────────────────────────────────────────

# (input_per_M, output_per_M, cache_read_per_M | None, cache_write_per_M | None)
_T = tuple[float, float, float | None, float | None]

# ── Method 1: Static table — official provider docs ───────────────────────────
#
# Prefix matching: "claude-opus-4-20250514" matches "claude-opus-4".
# Keys sorted by length (longest first) so "gpt-4o-mini" matches before "gpt-4o".
#
# Sources:
#   Anthropic  : https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
#   OpenAI     : https://openai.com/api/pricing/
#   Google     : https://ai.google.dev/pricing
#   DeepSeek   : https://api-docs.deepseek.com/quick_start/pricing
#   AWS Bedrock: https://aws.amazon.com/bedrock/pricing/

MODEL_PRICING: dict[str, _T] = {
    # ── Anthropic ────────────────────────────────────────────────────────────
    "claude-opus-4":               (15.00, 75.00,  1.50, 18.75),
    "claude-sonnet-4":             ( 3.00, 15.00,  0.30,  3.75),
    "claude-haiku-4":              ( 0.80,  4.00,  0.08,  1.00),
    "claude-3-7-sonnet":           ( 3.00, 15.00,  0.30,  3.75),
    "claude-3-5-sonnet":           ( 3.00, 15.00,  0.30,  3.75),
    "claude-3-5-haiku":            ( 0.80,  4.00,  0.08,  1.00),
    "claude-3-opus":               (15.00, 75.00,  1.50, 18.75),
    "claude-3-haiku":              ( 0.25,  1.25,  0.03,  0.30),
    "claude-3-sonnet":             ( 3.00, 15.00,  None,  None),
    # ── OpenAI ───────────────────────────────────────────────────────────────
    "gpt-4.1-nano":                ( 0.10,  0.40,  0.025, None),
    "gpt-4.1-mini":                ( 0.40,  1.60,  0.10,  None),
    "gpt-4.1":                     ( 2.00,  8.00,  0.50,  None),
    "gpt-4o-mini":                 ( 0.15,  0.60,  0.075, None),
    "gpt-4o":                      ( 2.50, 10.00,  1.25,  None),
    "gpt-4-turbo":                 (10.00, 30.00,  None,  None),
    "gpt-4":                       (30.00, 60.00,  None,  None),
    "gpt-3.5-turbo":               ( 0.50,  1.50,  None,  None),
    "o3-mini":                     ( 1.10,  4.40,  0.55,  None),
    "o3":                          (10.00, 40.00,  2.50,  None),
    "o1-mini":                     ( 1.10,  4.40,  0.55,  None),
    "o1":                          (15.00, 60.00,  7.50,  None),
    # ── Google Gemini ─────────────────────────────────────────────────────────
    "gemini-2.5-pro":              ( 1.25, 10.00,  None,  None),
    "gemini-2.5-flash":            ( 0.15,  0.60,  None,  None),
    "gemini-2.0-flash":            ( 0.10,  0.40,  None,  None),
    "gemini-1.5-pro":              ( 1.25,  5.00,  None,  None),
    "gemini-1.5-flash":            ( 0.075, 0.30,  None,  None),
    # ── DeepSeek ─────────────────────────────────────────────────────────────
    "deepseek-reasoner":           ( 0.55,  2.19,  None,  None),
    "deepseek-chat":               ( 0.14,  0.28,  None,  None),
    "deepseek-coder":              ( 0.14,  0.28,  None,  None),
    # ── Meta / Llama ─────────────────────────────────────────────────────────
    "llama-4-maverick":            ( 0.27,  0.85,  None,  None),
    "llama-4-scout":               ( 0.18,  0.59,  None,  None),
    "llama-3.3-70b":               ( 0.88,  0.88,  None,  None),
    "llama-3-70b":                 ( 0.65,  2.75,  None,  None),
    "llama-3-8b":                  ( 0.05,  0.20,  None,  None),
    # ── Alibaba / Qwen ───────────────────────────────────────────────────────
    "qwen3-235b":                  ( 4.00, 16.00,  None,  None),
    "qwen3-32b":                   ( 0.30,  1.20,  None,  None),
    "qwen3-4b":                    ( 0.02,  0.08,  None,  None),
    # ── Arcee ────────────────────────────────────────────────────────────────
    "trinity-large":               ( 0.25,  1.00,  0.25,  0.25),
    "trinity-mini":                ( 0.045, 0.15,  0.045, 0.045),
    # ── Together AI / HuggingFace (namespace-stripped prefix keys) ────────────
    "kimi-k2":                     ( 0.50,  2.80,  None,  None),
    "deepseek-v3":                 ( 0.60,  1.25,  None,  None),
    "deepseek-r1":                 ( 3.00,  7.00,  None,  None),
    # ── Vercel AI Gateway ────────────────────────────────────────────────────
    "gpt-5.4-pro":                 (30.00, 180.00, None,  None),
    "gpt-5.4":                     ( 2.50, 15.00,  None,  None),
    # ── AWS Bedrock ──────────────────────────────────────────────────────────
    "anthropic.claude-opus-4":     (15.00, 75.00,  None,  None),
    "anthropic.claude-sonnet-4":   ( 3.00, 15.00,  None,  None),
    "anthropic.claude-haiku-4":    ( 0.80,  4.00,  None,  None),
    "anthropic.claude-3-5-sonnet": ( 3.00, 15.00,  None,  None),
    "anthropic.claude-3-5-haiku":  ( 0.80,  4.00,  None,  None),
    "amazon.nova-pro":             ( 0.80,  3.20,  None,  None),
    "amazon.nova-lite":            ( 0.06,  0.24,  None,  None),
    "amazon.nova-micro":           ( 0.035, 0.14,  None,  None),
}

_SORTED_KEYS: list[str] = sorted(MODEL_PRICING, key=len, reverse=True)

# ── Method 2: Runtime registry — platforms register their own catalog ─────────

_RUNTIME_REGISTRY: dict[str, _T] = {}
_SORTED_RUNTIME:   list[str]     = []


def register_prices(
    catalog: dict[str, dict[str, float | None] | _T],
) -> None:
    """Register platform-specific model prices at startup.

    Each entry maps a model ID (or prefix) to pricing:
      { "model-id": {"input": 1.25, "output": 5.00, "cache_read": 0.12, "cache_write": None} }
    or a 4-tuple: { "model-id": (1.25, 5.00, 0.12, None) }

    Registered prices take precedence over the static table but are overridden
    by cost_overrides passed directly to estimate_cost().
    """
    global _SORTED_RUNTIME
    for model, pricing in catalog.items():
        key = model.lower()
        if isinstance(pricing, dict):
            entry: _T = (
                float(pricing.get("input") or 0),
                float(pricing.get("output") or 0),
                float(pricing["cache_read"]) if pricing.get("cache_read") is not None else None,
                float(pricing["cache_write"]) if pricing.get("cache_write") is not None else None,
            )
        else:
            entry = pricing
        _RUNTIME_REGISTRY[key] = entry
    _SORTED_RUNTIME = sorted(_RUNTIME_REGISTRY, key=len, reverse=True)
    logger.debug("agentmetrics: registered %d model price entries", len(_RUNTIME_REGISTRY))


# ── Method 3: LiteLLM — optional import, 300+ models ─────────────────────────

def _try_litellm(
    model_lower: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
) -> float | None:
    """Try litellm's model cost database. Returns None if litellm is not installed
    or the model is not in its database."""
    try:
        import litellm  # type: ignore[import-not-found]
        cost_map: dict[str, Any] = getattr(litellm, "model_cost", None) or {}
        if not cost_map:
            return None

        # litellm uses exact model IDs; try exact, then strip date suffix
        import re
        entry = (
            cost_map.get(model_lower)
            or cost_map.get(re.sub(r"-\d{8}$", "", model_lower))
        )
        if not entry:
            return None

        in_per_m  = (entry.get("input_cost_per_token")  or 0) * 1_000_000
        out_per_m = (entry.get("output_cost_per_token") or 0) * 1_000_000
        cr_raw = entry.get("cache_read_input_token_cost")
        cw_raw = entry.get("cache_creation_input_token_cost")
        cr_per_m: float | None = float(cr_raw) * 1_000_000 if cr_raw is not None else None
        cw_per_m: float | None = float(cw_raw) * 1_000_000 if cw_raw is not None else None

        return _compute((in_per_m, out_per_m, cr_per_m, cw_per_m), input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
    except Exception:
        return None


# ── Method 4: OpenRouter API — explicit opt-in, covers everything OR routes ───

_OPENROUTER_CACHE: dict[str, _T] = {}
_SORTED_OPENROUTER: list[str]    = []


def populate_from_openrouter(
    api_key: str,
    base_url: str = "https://openrouter.ai",
    timeout: int = 15,
) -> int:
    """Fetch live model pricing from OpenRouter's /api/v1/models endpoint.

    Call once at application startup. Results are cached in memory for the
    process lifetime. Returns the number of models successfully loaded.

    Requires network access and a valid OpenRouter API key.
    """
    global _SORTED_OPENROUTER
    url = f"{base_url.rstrip('/')}/api/v1/models"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data: dict = json.loads(resp.read())
    except Exception as exc:
        logger.warning("agentmetrics: populate_from_openrouter failed: %s", exc)
        return 0

    loaded = 0
    for m in data.get("data", []):
        model_id = (m.get("id") or "").lower()
        if not model_id:
            continue
        p = m.get("pricing") or {}
        prompt     = p.get("prompt")
        completion = p.get("completion")
        if prompt is None and completion is None:
            continue
        in_per_m  = float(prompt or 0)     * 1_000_000
        out_per_m = float(completion or 0) * 1_000_000
        cr_raw = p.get("cache_read") or p.get("cached_prompt") or p.get("input_cache_read")
        cw_raw = p.get("cache_write") or p.get("cache_creation") or p.get("input_cache_write")
        cr_per_m: float | None = float(cr_raw) * 1_000_000 if cr_raw is not None else None
        cw_per_m: float | None = float(cw_raw) * 1_000_000 if cw_raw is not None else None
        # Store with stripped namespace so lookups work (estimate_cost strips before lookup)
        key = model_id.split("/", 1)[1] if "/" in model_id else model_id
        _OPENROUTER_CACHE[key] = (in_per_m, out_per_m, cr_per_m, cw_per_m)
        loaded += 1

    _SORTED_OPENROUTER = sorted(_OPENROUTER_CACHE, key=len, reverse=True)
    logger.info("agentmetrics: loaded %d model prices from OpenRouter", loaded)
    return loaded


# ── Core estimation — tries all methods in priority order ─────────────────────

def estimate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    cost_overrides: dict[str, _T] | None = None,
) -> float | None:
    """Return USD cost for the given model and token counts, or None if unknown.

    Resolution order:
      1. cost_overrides  — caller-supplied explicit prices (highest priority)
      2. Runtime registry — registered via register_prices() at startup
      3. Static table    — official provider docs (40+ known models)
      4. LiteLLM         — if litellm is installed (300+ models)
      5. OpenRouter cache — if populate_from_openrouter() was called
      6. None            — unknown model, never guesses

    Strips provider namespace: "openai/gpt-4o" → "gpt-4o".
    Prefix matches versioned IDs: "claude-opus-4-20250514" → "claude-opus-4".
    """
    if not any([input_tokens, output_tokens, cache_read_tokens, cache_write_tokens]):
        return 0.0

    model_lower = (model or "").lower().strip()
    if not model_lower:
        return None

    # Strip provider namespace: "openai/gpt-4o" → "gpt-4o"
    if "/" in model_lower:
        model_lower = model_lower.split("/", 1)[1]

    # 1. Explicit overrides
    if cost_overrides:
        for key in sorted(cost_overrides, key=len, reverse=True):
            if model_lower.startswith(key.lower()):
                return _compute(cost_overrides[key], input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)

    # 2. Runtime registry (platforms register at startup)
    for key in _SORTED_RUNTIME:
        if model_lower.startswith(key):
            return _compute(_RUNTIME_REGISTRY[key], input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)

    # 3. Static table (official docs, pre-sorted by length)
    for key in _SORTED_KEYS:
        if model_lower.startswith(key):
            return _compute(MODEL_PRICING[key], input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)

    # 4. LiteLLM (optional import)
    litellm_result = _try_litellm(model_lower, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
    if litellm_result is not None:
        return litellm_result

    # 5. OpenRouter cache (if populated at startup)
    for key in _SORTED_OPENROUTER:
        if model_lower.startswith(key) or model_lower == key:
            return _compute(_OPENROUTER_CACHE[key], input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)

    return None  # unknown model — never guesses


def _compute(
    prices: _T,
    in_t: int,
    out_t: int,
    cache_read: int,
    cache_write: int,
) -> float:
    in_p:  float       = prices[0] or 0.0
    out_p: float       = prices[1] or 0.0
    cr_p:  float | None = prices[2] if len(prices) > 2 else None
    cw_p:  float | None = prices[3] if len(prices) > 3 else None

    cost = (in_t / 1_000_000.0) * in_p + (out_t / 1_000_000.0) * out_p
    if cache_read  and cr_p is not None:
        cost += (cache_read  / 1_000_000.0) * cr_p
    if cache_write and cw_p is not None:
        cost += (cache_write / 1_000_000.0) * cw_p
    return round(cost, 6)
