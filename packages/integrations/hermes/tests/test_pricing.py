from __future__ import annotations

import pytest

from agentmetrics_hermes.pricing import estimate_cost


@pytest.mark.unit
def test_known_model_exact() -> None:
    cost = estimate_cost("gpt-4o", input_tokens=1_000_000, output_tokens=0)
    assert abs(cost - 2.50) < 0.001


@pytest.mark.unit
def test_known_model_prefix_match() -> None:
    # claude-sonnet-4-6-20251022 should match the claude-sonnet-4-6 prefix.
    cost = estimate_cost("claude-sonnet-4-6-20251022", input_tokens=1_000_000, output_tokens=0)
    assert abs(cost - 3.00) < 0.001


@pytest.mark.unit
def test_cache_tokens() -> None:
    cost = estimate_cost(
        "claude-sonnet-4-6",
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=1_000_000,
        cache_write_tokens=0,
    )
    assert abs(cost - 0.30) < 0.001


@pytest.mark.unit
def test_zero_tokens_returns_zero() -> None:
    assert estimate_cost("gpt-4o", 0, 0) == 0.0


@pytest.mark.unit
def test_unknown_model_returns_none() -> None:
    cost = estimate_cost("some-future-model-xyz", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost is None


@pytest.mark.unit
def test_cost_override_takes_precedence() -> None:
    overrides = {"my-custom-model": [0.01, 0.02, None, None]}
    cost = estimate_cost(
        "my-custom-model", input_tokens=1_000_000, output_tokens=0, cost_overrides=overrides
    )
    assert abs(cost - 0.01) < 0.001


@pytest.mark.unit
@pytest.mark.parametrize("model", ["claude-opus-4-7", "gpt-4o-mini", "gemini-2.0-flash", "deepseek-chat"])
def test_all_pricing_table_entries_positive(model: str) -> None:
    cost = estimate_cost(model, input_tokens=100_000, output_tokens=100_000)
    assert cost > 0
