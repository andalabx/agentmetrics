from __future__ import annotations

import time

import pytest

from agentmetrics_hermes.config import AgentMetricsConfig
from agentmetrics_hermes.hooks import AgentMetricsHooks
from agentmetrics_hermes.pipeline import EventPipeline
from agentmetrics_hermes.state import StateStore


def _make_hooks(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> AgentMetricsHooks:
    return AgentMetricsHooks(cfg, pipeline, store)


def _flushed(pipeline: EventPipeline) -> list[dict]:
    pipeline.flush_now()
    # Collect what was sent by inspecting sent count.
    return []  # Events are sent to stub client — we verify via state and counters.


@pytest.mark.unit
def test_session_start_creates_session(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> None:
    hooks = _make_hooks(cfg, pipeline, store)
    hooks.on_session_start(session_id="sess-1", agent_id="hermes")

    session = store.get_session("sess-1")
    assert session is not None
    assert session.agent_id == "hermes"
    assert session.trace_id  # UUID assigned


@pytest.mark.unit
def test_session_end_fires_metrics_event(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> None:
    hooks = _make_hooks(cfg, pipeline, store)
    hooks.on_session_start(session_id="sess-2")
    hooks.on_session_end(session_id="sess-2")

    assert pipeline.sent == 0  # not flushed yet
    pipeline.flush_now()
    assert pipeline.sent >= 1  # session_start + session_metrics
    assert store.get_session("sess-2") is None  # cleaned up


@pytest.mark.unit
def test_pre_api_request_creates_run(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> None:
    hooks = _make_hooks(cfg, pipeline, store)
    hooks.on_session_start(session_id="sess-3")
    hooks.pre_api_request(session_id="sess-3", model="claude-sonnet-4-6", provider="anthropic")

    run = store.get_active_run("sess-3")
    assert run is not None
    assert run.llm_calls == 1
    assert run.model == "claude-sonnet-4-6"


@pytest.mark.unit
def test_post_api_request_accumulates_tokens(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> None:
    hooks = _make_hooks(cfg, pipeline, store)
    hooks.on_session_start(session_id="sess-4")
    hooks.pre_api_request(session_id="sess-4", model="gpt-4o")
    hooks.post_api_request(
        session_id="sess-4",
        model="gpt-4o",
        usage={"input_tokens": 500, "output_tokens": 200},
        finish_reason="stop",
    )

    session = store.get_session("sess-4")
    # finish_reason=stop closes the run — session still exists until session_end.
    # Tokens should be accumulated in the session.
    assert session is not None
    assert session.total_input_tokens == 500
    assert session.total_output_tokens == 200


@pytest.mark.unit
def test_tool_call_increments_counters(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> None:
    hooks = _make_hooks(cfg, pipeline, store)
    hooks.on_session_start(session_id="sess-5")
    hooks.pre_llm_call(session_id="sess-5")
    hooks.pre_tool_call(session_id="sess-5", tool_name="bash")
    hooks.post_tool_call(session_id="sess-5", tool_name="bash", status="ok")

    run = store.get_active_run("sess-5")
    assert run is not None
    assert run.tool_calls == 1
    assert run.tool_errors == 0
    assert "bash" in run.tool_names


@pytest.mark.unit
def test_tool_error_increments_error_counter(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> None:
    hooks = _make_hooks(cfg, pipeline, store)
    hooks.on_session_start(session_id="sess-6")
    hooks.pre_llm_call(session_id="sess-6")
    hooks.pre_tool_call(session_id="sess-6", tool_name="bash")
    hooks.post_tool_call(
        session_id="sess-6", tool_name="bash", status="error", error="exit code 1"
    )

    run = store.get_active_run("sess-6")
    assert run is not None
    assert run.tool_errors == 1
    assert run.last_error == "exit code 1"


@pytest.mark.unit
def test_full_turn_emits_agent_end(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> None:
    hooks = _make_hooks(cfg, pipeline, store)
    hooks.on_session_start(session_id="sess-7")
    hooks.pre_api_request(session_id="sess-7", model="claude-sonnet-4-6")
    hooks.pre_tool_call(session_id="sess-7", tool_name="read_file")
    hooks.post_tool_call(session_id="sess-7", tool_name="read_file", status="ok")
    hooks.post_api_request(
        session_id="sess-7",
        model="claude-sonnet-4-6",
        usage={"input_tokens": 1000, "output_tokens": 500},
        finish_reason="stop",
    )

    # agent_end + tool events + llm events should all be queued.
    pipeline.flush_now()
    assert pipeline.sent >= 1


@pytest.mark.unit
def test_hooks_never_raise_on_bad_kwargs(
    cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore
) -> None:
    hooks = _make_hooks(cfg, pipeline, store)
    # Missing fields — should not raise.
    hooks.on_session_start()
    hooks.pre_tool_call()
    hooks.post_tool_call()
    hooks.api_request_error()
