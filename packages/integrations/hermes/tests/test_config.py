from __future__ import annotations

import pytest

from agentmetrics_hermes.config import AgentMetricsConfig, _validate_endpoint


@pytest.mark.unit
def test_defaults() -> None:
    cfg = AgentMetricsConfig()
    assert cfg.enabled is True
    assert cfg.endpoint == "http://localhost:8099"
    assert cfg.flush_interval == 10
    assert cfg.batch_size == 100
    assert cfg.redaction_mode == "strict"


@pytest.mark.unit
def test_validate_endpoint_rejects_bad_scheme() -> None:
    result = _validate_endpoint("ftp://badscheme.example.com")
    assert result == "http://localhost:8099"


@pytest.mark.unit
def test_validate_endpoint_allows_localhost_http() -> None:
    result = _validate_endpoint("http://localhost:8099")
    assert result == "http://localhost:8099"


@pytest.mark.unit
def test_validate_endpoint_allows_https_remote() -> None:
    result = _validate_endpoint("https://metrics.example.com")
    assert result == "https://metrics.example.com"


@pytest.mark.unit
def test_env_var_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENTMETRICS_API_KEY", "am_from_env_key")
    monkeypatch.setenv("AGENTMETRICS_URL", "http://localhost:8099")
    # Simulate hermes_cli not installed.
    cfg = AgentMetricsConfig.load()
    assert cfg.api_key == "am_from_env_key"
    assert cfg.enabled is True


@pytest.mark.unit
def test_env_var_missing_disables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENTMETRICS_API_KEY", raising=False)
    monkeypatch.delenv("AGENTMETRICS_URL", raising=False)
    cfg = AgentMetricsConfig.load()
    assert cfg.enabled is False
