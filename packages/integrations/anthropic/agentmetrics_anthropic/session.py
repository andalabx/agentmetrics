from __future__ import annotations

import time
from typing import Any

from agentmetrics.http_client import HttpClient
from agentmetrics_shared import AgentEndEvent, estimate_cost


class _SessionState:
    __slots__ = (
        "_emitted",
        "agent_id",
        "cache_read_tokens",
        "cache_write_tokens",
        "error",
        "input_tokens",
        "llm_calls",
        "model",
        "output_tokens",
        "session_id",
        "start_ms",
        "status",
        "tool_calls",
        "tool_errors",
        "tool_names",
    )

    def __init__(self, agent_id: str, session_id: str) -> None:
        self.agent_id   = agent_id
        self.session_id = session_id
        self.start_ms   = time.monotonic()
        self.input_tokens     = 0
        self.output_tokens    = 0
        self.cache_read_tokens  = 0
        self.cache_write_tokens = 0
        self.llm_calls   = 0
        self.tool_calls  = 0
        self.tool_errors = 0
        self.tool_names: set[str] = set()
        self.model: str | None = None
        self.status = "success"
        self.error: str | None = None
        self._emitted = False

    def absorb_span_end(self, event: Any) -> None:
        """Extract token counts from span.model_request_end event."""
        usage = getattr(event, "usage", None) or {}
        if isinstance(usage, dict):
            self.input_tokens       += usage.get("input_tokens", 0) or 0
            self.output_tokens      += usage.get("output_tokens", 0) or 0
            self.cache_read_tokens  += usage.get("cache_read_input_tokens", 0) or 0
            self.cache_write_tokens += usage.get("cache_creation_input_tokens", 0) or 0
        else:
            self.input_tokens       += getattr(usage, "input_tokens", 0) or 0
            self.output_tokens      += getattr(usage, "output_tokens", 0) or 0
            self.cache_read_tokens  += getattr(usage, "cache_read_input_tokens", 0) or 0
            self.cache_write_tokens += getattr(usage, "cache_creation_input_tokens", 0) or 0
        if not self.model:
            self.model = getattr(event, "model", None)
        self.llm_calls += 1

    def absorb_tool(self, event: Any, error: bool = False) -> None:
        self.tool_calls += 1
        if error:
            self.tool_errors += 1
        name = getattr(event, "tool_name", None) or getattr(event, "name", None)
        if name:
            self.tool_names.add(str(name))


def _process_event(state: _SessionState, event: Any) -> bool:
    """
    Process one SSE event from the Managed Agents session stream.
    Returns True if the session has terminated and the run is complete.
    """
    etype = getattr(event, "type", "") or ""

    # LLM call completed - extract tokens
    if etype == "span.model_request_end":
        state.absorb_span_end(event)

    # Tool call
    elif etype in ("agent.tool_use", "agent.mcp_tool_use", "agent.custom_tool_use"):
        state.absorb_tool(event)

    # Tool result error
    elif etype == "agent.tool_result":
        content = getattr(event, "content", None)
        is_error = getattr(content, "is_error", False) if content else False
        if is_error:
            state.tool_errors += 1

    # Session error
    elif etype == "session.error":
        state.status = "failed"
        state.error  = str(getattr(event, "error", ""))[:500] or None

    # Session terminated → run complete
    elif etype == "session.status_terminated":
        state.status = "failed"
        # INT-13: if terminated due to error (not normal completion), count it
        if getattr(event, "error", None) is not None:
            state.tool_errors = getattr(state, "tool_errors", 0) + 1
        return True

    return False


class AgentMetricsSessionTracker:
    """
    Wraps a Claude Managed Agents session and tracks observability data.

    Usage (sync stream)::

        from agentmetrics_anthropic import AgentMetricsSessionTracker

        tracker = AgentMetricsSessionTracker(api_key="am_...", agent_id="my-agent")

        with tracker.stream(client, session_id="sess_...") as stream:
            for event in stream:
                ...  # handle events as normal

    Usage (async stream)::

        async with tracker.astream(client, session_id="sess_...") as stream:
            async for event in stream:
                ...
    """

    def __init__(
        self,
        api_key: str,
        agent_id: str = "anthropic-agent",
        base_url: str = "http://localhost:8099",
    ) -> None:
        self._client   = HttpClient(api_key=api_key, base_url=base_url)
        self._agent_id = agent_id

    def _fresh_state(self, session_id: str) -> _SessionState:
        """INT-14: Create a fresh per-run state, resetting all counters and the _emitted flag."""
        return _SessionState(self._agent_id, session_id)

    def stream(self, client: Any, session_id: str, **kwargs: Any) -> _SyncStreamContext:
        return _SyncStreamContext(self._client, self._agent_id, client, session_id, kwargs, self._fresh_state)

    def astream(self, client: Any, session_id: str, **kwargs: Any) -> _AsyncStreamContext:
        return _AsyncStreamContext(self._client, self._agent_id, client, session_id, kwargs, self._fresh_state)

    def flush(self, timeout: float = 10.0) -> None:
        self._client.flush(timeout=timeout)


class _SyncStreamContext:
    def __init__(
        self,
        http: HttpClient,
        agent_id: str,
        client: Any,
        session_id: str,
        kwargs: dict,
        fresh_state: Any = None,
    ) -> None:
        self._http        = http
        self._agent_id    = agent_id
        self._client      = client
        self._session_id  = session_id
        self._kwargs      = kwargs
        self._fresh_state = fresh_state
        self._state: _SessionState | None = None

    def __enter__(self) -> _SyncTrackingIter:
        # INT-14: use the factory to create a fresh state, resetting all per-run fields
        if self._fresh_state is not None:
            self._state = self._fresh_state(self._session_id)
        else:
            self._state = _SessionState(self._agent_id, self._session_id)
        raw = self._client.beta.sessions.events.stream(
            self._session_id, **self._kwargs
        )
        return _SyncTrackingIter(raw, self._state, self._http)

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._state:
            if exc_type is not None:
                self._state.status = "failed"
                self._state.error  = str(exc_val)[:500]
            if not self._state._emitted:
                self._state._emitted = True
                _emit(self._http, self._state)


class _SyncTrackingIter:
    def __init__(self, raw: Any, state: _SessionState, http: HttpClient) -> None:
        self._raw   = raw
        self._state = state
        self._http  = http
        self._done  = False

    def __iter__(self) -> _SyncTrackingIter:
        return self

    def __next__(self) -> Any:
        if self._done:
            raise StopIteration
        event = next(self._raw)
        done  = _process_event(self._state, event)
        if done:
            self._done = True
            if not self._state._emitted:
                self._state._emitted = True
                _emit(self._http, self._state)
        return event


class _AsyncStreamContext:
    def __init__(
        self,
        http: HttpClient,
        agent_id: str,
        client: Any,
        session_id: str,
        kwargs: dict,
        fresh_state: Any = None,
    ) -> None:
        self._http        = http
        self._agent_id    = agent_id
        self._client      = client
        self._session_id  = session_id
        self._kwargs      = kwargs
        self._fresh_state = fresh_state
        self._state: _SessionState | None = None

    async def __aenter__(self) -> _AsyncTrackingIter:
        # INT-14: use the factory to create a fresh state, resetting all per-run fields
        if self._fresh_state is not None:
            self._state = self._fresh_state(self._session_id)
        else:
            self._state = _SessionState(self._agent_id, self._session_id)
        raw = self._client.beta.sessions.events.stream(
            self._session_id, **self._kwargs
        )
        return _AsyncTrackingIter(raw, self._state, self._http)

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._state:
            if exc_type is not None:
                self._state.status = "failed"
                self._state.error  = str(exc_val)[:500]
            if not self._state._emitted:
                self._state._emitted = True
                _emit(self._http, self._state)


class _AsyncTrackingIter:
    def __init__(self, raw: Any, state: _SessionState, http: HttpClient) -> None:
        self._raw   = raw
        self._state = state
        self._http  = http
        self._done  = False

    def __aiter__(self) -> _AsyncTrackingIter:
        return self

    async def __anext__(self) -> Any:
        if self._done:
            raise StopAsyncIteration
        event = await self._raw.__anext__()
        done  = _process_event(self._state, event)
        if done:
            self._done = True
            if not self._state._emitted:
                self._state._emitted = True
                _emit(self._http, self._state)
        return event


def _emit(http: HttpClient, state: _SessionState) -> None:
    duration_ms = (time.monotonic() - state.start_ms) * 1000
    ev = AgentEndEvent(agent_id=state.agent_id, platform="anthropic")
    ev.session_id         = state.session_id
    ev.trace_id           = state.session_id
    ev.input_tokens       = state.input_tokens
    ev.output_tokens      = state.output_tokens
    ev.cache_read_tokens  = state.cache_read_tokens
    ev.cache_write_tokens = state.cache_write_tokens
    ev.llm_calls          = state.llm_calls
    ev.tool_calls         = state.tool_calls
    ev.tool_errors        = state.tool_errors
    ev.tool_names         = list(state.tool_names)
    ev.status             = state.status
    ev.duration_ms        = round(duration_ms, 2)
    ev.error              = state.error
    ev.model              = state.model
    ev.estimated_cost_usd = estimate_cost(
        state.model or "", state.input_tokens, state.output_tokens,
        state.cache_read_tokens, state.cache_write_tokens,
    ) or None
    http.fire_and_forget(ev.to_payload())
