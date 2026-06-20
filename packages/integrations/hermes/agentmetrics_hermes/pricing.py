from __future__ import annotations

from typing import Any

from agentmetrics_shared.pricing import _SORTED_KEYS, _compute

# Hermes plugin pricing — only used when agent.usage_pricing is unavailable
# (e.g. standalone unit tests). Production path uses Hermes's own
# estimate_usage_cost() which has live OpenRouter pricing and a more complete
# official-docs snapshot.
#
# No fallback for unknown models — returns None rather than fabricating a number.
from agentmetrics_shared.pricing import MODEL_PRICING as MODEL_PRICING


def estimate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    cost_overrides: dict[str, Any] | None = None,
) -> float | None:
    """Return USD cost or None for unknown models. No fallback."""
    if not any([input_tokens, output_tokens, cache_read_tokens, cache_write_tokens]):
        return 0.0

    model_lower = (model or "").lower().strip()
    if not model_lower:
        return None

    if "/" in model_lower:
        model_lower = model_lower.split("/", 1)[1]

    if cost_overrides:
        for key in sorted(cost_overrides, key=len, reverse=True):
            if model_lower.startswith(key.lower()):
                return float(_compute(cost_overrides[key], input_tokens, output_tokens, cache_read_tokens, cache_write_tokens))

    for key in _SORTED_KEYS:
        if model_lower.startswith(key):
            return float(_compute(MODEL_PRICING[key], input_tokens, output_tokens, cache_read_tokens, cache_write_tokens))

    return None
