from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from agentmetrics_hermes.config import AgentMetricsConfig
from agentmetrics_hermes.redact import (
    RedactionMode,
    _hash_name,
    redact_tool_name,
    scrub_secrets,
)


@pytest.mark.unit
@pytest.mark.parametrize(
    ("text", "expected_substr"),
    [
        ("sk-proj-abc123def456ghi789jkl012", "[REDACTED]"),
        ("am_R4Z5nEek1234567890abcdefg", "[REDACTED]"),
        ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.abc123", "[REDACTED]"),
        ('{"password": "hunter2hunter"}', "[REDACTED]"),
        ("normal text with no secrets", "normal text with no secrets"),
    ],
)
def test_scrub_secrets_strict(text: str, expected_substr: str) -> None:
    result = scrub_secrets(text, RedactionMode.STRICT)
    assert expected_substr in result


@pytest.mark.unit
def test_debug_mode_skips_scrubbing() -> None:
    secret = "sk-proj-abc123def456ghi789jkl012"
    result = scrub_secrets(secret, RedactionMode.DEBUG)
    assert result == secret


@pytest.mark.unit
def test_hash_name_is_deterministic() -> None:
    assert _hash_name("bash") == _hash_name("bash")


@pytest.mark.unit
def test_hash_name_differs_for_different_names() -> None:
    assert _hash_name("bash") != _hash_name("read_file")


@pytest.mark.unit
def test_hash_name_prefix() -> None:
    assert _hash_name("any_tool").startswith("t_")


@pytest.mark.unit
def test_redact_tool_name_blocklist() -> None:
    cfg = AgentMetricsConfig(exported_tool_names="blocklist", redact_tool_names=["bash"])
    assert redact_tool_name("read_file", cfg) == "read_file"
    result = redact_tool_name("bash", cfg)
    assert result is not None and result.startswith("t_")


@pytest.mark.unit
def test_redact_tool_name_allowlist() -> None:
    cfg = AgentMetricsConfig(exported_tool_names="allowlist", redact_tool_names=["read_file"])
    assert redact_tool_name("read_file", cfg) == "read_file"
    assert redact_tool_name("bash", cfg) is None


@pytest.mark.unit
def test_redact_tool_name_hash() -> None:
    cfg = AgentMetricsConfig(exported_tool_names="hash")
    result = redact_tool_name("bash", cfg)
    assert result is not None and result.startswith("t_")


@pytest.mark.unit
def test_redact_tool_name_off() -> None:
    cfg = AgentMetricsConfig(exported_tool_names="off")
    assert redact_tool_name("bash", cfg) is None


@pytest.mark.unit
@given(st.text())
def test_scrub_never_crashes(text: str) -> None:
    # Property: scrub_secrets never raises for any string input.
    result = scrub_secrets(text, RedactionMode.STRICT)
    assert isinstance(result, str)


@pytest.mark.unit
@given(st.text(min_size=1, max_size=30))
def test_tool_name_redaction_never_crashes(name: str) -> None:
    cfg = AgentMetricsConfig(exported_tool_names="hash")
    result = redact_tool_name(name, cfg)
    assert result is None or isinstance(result, str)
