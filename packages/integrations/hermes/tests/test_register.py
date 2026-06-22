"""Regression tests for the plugin registration contract.

Incident: agentmetrics-hermes v0.2.0 registered post_api_request as
llm_execution *middleware* (ctx.register_middleware), causing every LLM call
to return None and fail validation in Hermes. Hooks must be fire-and-forget
observers registered via ctx.register_hook, never middleware.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from agentmetrics_hermes import register
from agentmetrics_hermes.config import AgentMetricsConfig


def _make_ctx() -> MagicMock:
    ctx = MagicMock()
    ctx.register_hook = MagicMock()
    ctx.register_middleware = MagicMock()
    ctx.register_command = MagicMock()
    return ctx


def _make_cfg(**kwargs: object) -> AgentMetricsConfig:
    return AgentMetricsConfig(
        enabled=True,
        endpoint="http://localhost:8099",
        api_key="am_test_key_1234567890",
        **kwargs,  # type: ignore[arg-type]
    )


@pytest.mark.unit
def test_register_uses_hooks_not_middleware(tmp_path: pytest.TempPathFactory) -> None:
    """register() must never call ctx.register_middleware.

    Hermes middleware intercepts the call chain and must return the LLM
    response. Our handlers return None (fire-and-forget observers), so using
    register_middleware would silently kill every LLM call.
    """
    ctx = _make_ctx()
    cfg = _make_cfg()

    with patch("agentmetrics_hermes.AgentMetricsConfig.load", return_value=cfg), \
         patch("agentmetrics_hermes.WriteAheadLog") as MockWAL, \
         patch("agentmetrics_hermes.EventPipeline") as MockPipeline:
        MockWAL.from_api_key.return_value = MagicMock(recover=MagicMock(return_value=[]))
        mock_pipeline = MagicMock()
        mock_pipeline.start = MagicMock()
        MockPipeline.return_value = mock_pipeline

        register(ctx)

    assert ctx.register_middleware.call_count == 0, (
        "register() called ctx.register_middleware — this breaks the Hermes LLM call chain. "
        "Use ctx.register_hook for all agentmetrics handlers."
    )
    assert ctx.register_hook.call_count > 0, "register() must register at least one hook"


@pytest.mark.unit
def test_post_api_request_hook_registered(tmp_path: pytest.TempPathFactory) -> None:
    """post_api_request must be registered as a hook, not middleware."""
    ctx = _make_ctx()
    cfg = _make_cfg()

    with patch("agentmetrics_hermes.AgentMetricsConfig.load", return_value=cfg), \
         patch("agentmetrics_hermes.WriteAheadLog") as MockWAL, \
         patch("agentmetrics_hermes.EventPipeline") as MockPipeline:
        MockWAL.from_api_key.return_value = MagicMock(recover=MagicMock(return_value=[]))
        mock_pipeline = MagicMock()
        mock_pipeline.start = MagicMock()
        MockPipeline.return_value = mock_pipeline

        register(ctx)

    registered_hooks = {call.args[0] for call in ctx.register_hook.call_args_list}
    assert "post_api_request" in registered_hooks, (
        "post_api_request hook not registered — LLM output events will not be captured"
    )
    assert "pre_api_request" in registered_hooks, (
        "pre_api_request hook not registered — LLM input events will not be captured"
    )


@pytest.mark.unit
def test_disabled_plugin_does_not_register(tmp_path: pytest.TempPathFactory) -> None:
    """Disabled plugin must not register any hooks or middleware."""
    ctx = _make_ctx()
    cfg = AgentMetricsConfig(enabled=False, endpoint="http://localhost:8099", api_key="")

    with patch("agentmetrics_hermes.AgentMetricsConfig.load", return_value=cfg):
        register(ctx)

    assert ctx.register_hook.call_count == 0
    assert ctx.register_middleware.call_count == 0
