from app.core.pricing import calculate_cost


def test_known_model():
    cost = calculate_cost("gpt-4o-mini", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost == 0.75  # $0.15 + $0.60


def test_unknown_model_falls_back():
    # Unknown models use gpt-4o pricing ($2.50 + $10)
    cost = calculate_cost("unknown-model-xyz", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost == 12.50


def test_zero_tokens():
    cost = calculate_cost("gpt-4o", input_tokens=0, output_tokens=0)
    assert cost == 0.0


def test_small_call():
    # 1000 input + 500 output tokens on claude-haiku-4-5
    cost = calculate_cost("claude-haiku-4-5", input_tokens=1000, output_tokens=500)
    # (1000 * 0.80 + 500 * 4.00) / 1_000_000 = (800 + 2000) / 1_000_000 = 0.0028
    assert abs(cost - 0.0028) < 1e-9
