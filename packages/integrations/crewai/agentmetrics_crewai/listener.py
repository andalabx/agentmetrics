from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from agentmetrics.http_client import HttpClient
from agentmetrics.tracker import _estimate_cost
from crewai.utilities.events import crewai_event_bus
from crewai.utilities.events.base_event_listener import BaseEventListener
from crewai.utilities.events.types.crew_events import (
    CrewKickoffCompletedEvent,
    CrewKickoffFailedEvent,
    CrewKickoffStartedEvent,
)
from crewai.utilities.events.types.llm_events import (
    LLMCallCompletedEvent,
    LLMCallFailedEvent,
)
from crewai.utilities.events.types.tool_usage_events import (
    ToolUsageErrorEvent,
    ToolUsageFinishedEvent,
)


class _KickoffState:
    __slots__ = (
        "agent_id",
        "cache_read_tokens",
        "cache_write_tokens",
        "error",
        "input_tokens",
        "llm_calls",
        "model",
        "output_tokens",
        "start_ms",
        "status",
        "tool_calls",
        "tool_errors",
        "tool_names",
        "trace_id",
    )

    def __init__(self, agent_id: str) -> None:
        self.trace_id   = str(uuid.uuid4())
        self.agent_id   = agent_id
        self.start_ms   = time.monotonic()
        self.input_tokens     = 0
        self.output_tokens    = 0
        self.cache_read_tokens: int | None  = None   # CrewAI does not expose cache token breakdown
        self.cache_write_tokens: int | None = None
        self.llm_calls    = 0
        self.tool_calls   = 0
        self.tool_errors  = 0
        self.tool_names: set[str] = set()
        self.model: str | None = None
        self.status = "success"
        self.error: str | None = None


class AgentMetricsListener(BaseEventListener):
    """
    CrewAI event listener that sends a run summary to AgentMetrics
    after each crew kickoff completes or fails.

    Instantiating this class is enough - it auto-registers globally.

    Usage::

        from agentmetrics_crewai import AgentMetricsListener

        AgentMetricsListener(api_key="am_...")
        result = MyCrew().kickoff()
    """

    def __init__(
        self,
        api_key: str,
        agent_id: str = "crewai-agent",
        base_url: str = "http://localhost:8099",
    ) -> None:
        self._client     = HttpClient(api_key=api_key, base_url=base_url)
        self._agent_id   = agent_id
        self._lock = threading.Lock()
        # run_key (UUID str) → KickoffState (tracks concurrent kickoffs)
        self._active: dict[str, _KickoffState] = {}
        # source_fingerprint → run_key; allows other events to find their state
        self._fingerprint_map: dict[str, str] = {}
        super().__init__()  # calls setup_listeners

    def setup_listeners(self, bus: Any) -> None:

        @crewai_event_bus.on(CrewKickoffStartedEvent)
        def on_kickoff_started(source: Any, event: CrewKickoffStartedEvent) -> None:
            # INT-02: use a UUID per kickoff as the run key to avoid fingerprint collisions
            run_key = str(uuid.uuid4())
            fp = event.source_fingerprint or run_key
            name = event.crew_name or self._agent_id
            with self._lock:
                self._active[run_key] = _KickoffState(name)
                self._fingerprint_map[fp] = run_key

        def _state_for_event(event: Any) -> _KickoffState | None:
            fp = event.source_fingerprint or ""
            with self._lock:
                run_key = self._fingerprint_map.get(fp)
                if run_key is None:
                    return None
                return self._active.get(run_key)

        def _pop_state_for_event(event: Any) -> _KickoffState | None:
            fp = event.source_fingerprint or ""
            with self._lock:
                run_key = self._fingerprint_map.pop(fp, None)
                if run_key is None:
                    return None
                return self._active.pop(run_key, None)

        @crewai_event_bus.on(LLMCallCompletedEvent)
        def on_llm_completed(source: Any, event: LLMCallCompletedEvent) -> None:
            state = _state_for_event(event)
            if state is None:
                return
            state.llm_calls += 1
            usage = event.usage or {}
            state.input_tokens  += usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0) or 0
            state.output_tokens += usage.get("completion_tokens", 0) or usage.get("output_tokens", 0) or 0
            # cache_read_tokens / cache_write_tokens remain None — CrewAI does not expose cache breakdown
            if not state.model and event.model:
                state.model = event.model

        @crewai_event_bus.on(LLMCallFailedEvent)
        def on_llm_failed(source: Any, event: LLMCallFailedEvent) -> None:
            state = _state_for_event(event)
            if state:
                state.status = "failed"

        @crewai_event_bus.on(ToolUsageFinishedEvent)
        def on_tool_finished(source: Any, event: ToolUsageFinishedEvent) -> None:
            state = _state_for_event(event)
            if state is None:
                return
            state.tool_calls += 1
            if event.tool_name:
                state.tool_names.add(event.tool_name)

        @crewai_event_bus.on(ToolUsageErrorEvent)
        def on_tool_error(source: Any, event: ToolUsageErrorEvent) -> None:
            state = _state_for_event(event)
            if state is None:
                return
            state.tool_calls  += 1
            # INT-03: use getattr with None check instead of hasattr
            if getattr(event, "error", None) is not None:
                state.tool_errors += 1
            if event.tool_name:
                state.tool_names.add(event.tool_name)

        @crewai_event_bus.on(CrewKickoffCompletedEvent)
        def on_kickoff_completed(source: Any, event: CrewKickoffCompletedEvent) -> None:
            state = _pop_state_for_event(event)
            if state:
                self._emit(state)

        @crewai_event_bus.on(CrewKickoffFailedEvent)
        def on_kickoff_failed(source: Any, event: CrewKickoffFailedEvent) -> None:
            state = _pop_state_for_event(event)
            if state:
                state.status = "failed"
                state.error  = str(event.error)[:500] if event.error else None
                self._emit(state)

    def _emit(self, state: _KickoffState) -> None:
        duration_ms = (time.monotonic() - state.start_ms) * 1000
        est = _estimate_cost(
            state.model,
            state.input_tokens, state.output_tokens,
            state.cache_read_tokens, state.cache_write_tokens,
        )
        payload: dict[str, Any] = {
            "event_id":                 str(uuid.uuid4()),
            "trace_id":                 state.trace_id,
            "agent_id":                 state.agent_id,
            "platform":                 "crewai",
            "event_name":               "agent_end",
            "ts":                       int(time.time() * 1000),
            "redaction_policy_version": "v1-strict",
            "status":      state.status,
            "duration_ms": round(duration_ms, 2),
            "tool_calls":  state.tool_calls,
            "tool_errors": state.tool_errors,
            "tool_names":  list(state.tool_names),
            "llm_calls":   state.llm_calls,
            "input_tokens":       state.input_tokens,
            "output_tokens":      state.output_tokens,
            "cache_read_tokens":  None,   # CrewAI does not expose cache token breakdown
            "cache_write_tokens": None,
        }
        if state.model:
            payload["model"] = state.model
        if state.error:
            payload["error"] = state.error
        if est is not None:
            payload["estimated_cost_usd"] = est
        self._client.fire_and_forget(payload)

    def flush(self, timeout: float = 10.0) -> None:
        self._client.flush(timeout=timeout)
