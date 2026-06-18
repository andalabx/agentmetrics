from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

from agentmetrics.http_client import HttpClient


def _build_payload(
    agent_id: str,
    trace_id: str,
    status: str,
    duration_ms: float,
    tool_calls: int,
    tool_errors: int,
    tool_names: set[str],
    llm_calls: int,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
    estimated_cost_usd: float | None,
    error: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "event_id":                 str(uuid.uuid4()),
        "trace_id":                 trace_id,
        "agent_id":                 agent_id,
        "platform":                 "autogen",
        "event_name":               "agent_end",
        "ts":                       int(time.time() * 1000),
        "redaction_policy_version": "v1-strict",
        "status":        status,
        "duration_ms":   round(duration_ms, 2),
        "tool_calls":    tool_calls,
        "tool_errors":   tool_errors,
        "tool_names":    list(tool_names),
        "llm_calls":     llm_calls,
        "input_tokens":  input_tokens,
        "output_tokens": output_tokens,
    }
    if cache_read_tokens:
        payload["cache_read_tokens"] = cache_read_tokens
    if cache_write_tokens:
        payload["cache_write_tokens"] = cache_write_tokens
    if estimated_cost_usd is not None:
        payload["estimated_cost_usd"] = estimated_cost_usd
    if error:
        payload["error"] = error[:500]
    return payload


class AgentMetricsRunStream:
    """
    Async context manager that wraps AutoGen's `run_stream()`, tracks run
    metrics, and sends a summary to AgentMetrics on completion.

    Usage::

        from agentmetrics_autogen import AgentMetricsRunStream

        tracker = AgentMetricsRunStream(api_key="am_...", agent_id="my-crew")

        async with tracker.run(team, task="...") as stream:
            async for event in stream:
                ...  # handle events as normal
    """

    def __init__(
        self,
        api_key: str,
        agent_id: str = "autogen-agent",
        base_url: str = "http://localhost:8099",
    ) -> None:
        self._client   = HttpClient(api_key=api_key, base_url=base_url)
        self._agent_id = agent_id

    def run(self, team: Any, **kwargs: Any) -> _RunContext:
        return _RunContext(self._client, self._agent_id, team, kwargs)

    def flush(self, timeout: float = 10.0) -> None:
        self._client.flush(timeout=timeout)


class _RunContext:
    def __init__(
        self,
        client: HttpClient,
        agent_id: str,
        team: Any,
        run_kwargs: dict[str, Any],
    ) -> None:
        self._client     = client
        self._agent_id   = agent_id
        self._team       = team
        self._run_kwargs = run_kwargs
        self._trace_id   = str(uuid.uuid4())
        self._start_ms   = 0.0
        self._tool_calls  = 0
        self._tool_errors = 0
        self._tool_names: set[str] = set()
        self._llm_calls    = 0
        self._input_tokens  = 0
        self._output_tokens = 0
        self._cache_read_tokens  = 0
        self._cache_write_tokens = 0
        self._status = "success"
        self._error: str | None = None
        # INT-11: track whether a TaskResult was received
        self._saw_result = False

    async def __aenter__(self) -> _TrackingStream:
        self._start_ms = time.monotonic()
        raw_stream = self._team.run_stream(**self._run_kwargs)
        return _TrackingStream(raw_stream, self)

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        # INT-12: handle CancelledError — set status to "cancelled" and re-raise
        if exc_type is asyncio.CancelledError:
            self._status = "cancelled"
            duration_ms = (time.monotonic() - self._start_ms) * 1000
            payload = _build_payload(
                self._agent_id,
                self._trace_id,
                self._status,
                duration_ms,
                self._tool_calls,
                self._tool_errors,
                self._tool_names,
                self._llm_calls,
                self._input_tokens,
                self._output_tokens,
                self._cache_read_tokens,
                self._cache_write_tokens,
                None,
                self._error,
            )
            self._client.fire_and_forget(payload)
            return False  # do not suppress — let CancelledError propagate
        if exc_type is not None:
            self._status = "failed"
            self._error  = str(exc_val)
        # INT-11: if stream ended normally but no TaskResult was seen, mark as failed
        if exc_type is None and not self._saw_result:
            self._status = "failed"
            self._error  = "Stream ended without TaskResult (possible cancellation)"
        duration_ms = (time.monotonic() - self._start_ms) * 1000
        payload = _build_payload(
            self._agent_id,
            self._trace_id,
            self._status,
            duration_ms,
            self._tool_calls,
            self._tool_errors,
            self._tool_names,
            self._llm_calls,
            self._input_tokens,
            self._output_tokens,
            self._cache_read_tokens,
            self._cache_write_tokens,
            None,
            self._error,
        )
        self._client.fire_and_forget(payload)


class _TrackingStream:
    """Async iterator that wraps the AutoGen run_stream() and intercepts events."""

    def __init__(self, raw_stream: Any, ctx: _RunContext) -> None:
        self._raw = raw_stream
        self._ctx = ctx

    def __aiter__(self) -> _TrackingStream:
        return self

    async def __anext__(self) -> Any:
        try:
            event = await self._raw.__anext__()
        except StopAsyncIteration:
            raise
        self._process(event)
        return event

    def _process(self, event: Any) -> None:
        cls_name = type(event).__name__

        if cls_name == "ModelClientStreamingChunkEvent":
            pass  # streaming partial; totals come from TaskResult or ModelCallEvent

        elif cls_name in ("ModelCallEvent", "LLMCallEvent"):
            self._ctx._llm_calls += 1
            usage = getattr(event, "usage", None) or {}
            if isinstance(usage, dict):
                self._ctx._input_tokens       += usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0) or 0
                self._ctx._output_tokens      += usage.get("completion_tokens", 0) or usage.get("output_tokens", 0) or 0
                self._ctx._cache_read_tokens  += usage.get("cache_read_input_tokens", 0) or 0
                self._ctx._cache_write_tokens += usage.get("cache_creation_input_tokens", 0) or 0
            else:
                self._ctx._input_tokens       += getattr(usage, "prompt_tokens", 0) or getattr(usage, "input_tokens", 0) or 0
                self._ctx._output_tokens      += getattr(usage, "completion_tokens", 0) or getattr(usage, "output_tokens", 0) or 0
                self._ctx._cache_read_tokens  += getattr(usage, "cache_read_input_tokens", 0) or 0
                self._ctx._cache_write_tokens += getattr(usage, "cache_creation_input_tokens", 0) or 0

        elif cls_name == "ToolCallRequestEvent":
            self._ctx._tool_calls += 1
            # tool_call.name may be on event.content or similar
            content = getattr(event, "content", None)
            if content:
                calls = getattr(content, "content", [content]) if not isinstance(content, list) else content
                for call in calls:
                    name = getattr(call, "name", None) or getattr(call, "function", {}).get("name")
                    if name:
                        self._ctx._tool_names.add(str(name))

        elif cls_name == "ToolCallExecutionEvent":
            # INT-09: use structured is_error field, with import guard for resilience
            try:
                from autogen_agentchat.messages import ToolCallExecutionEvent as _TCE
                if isinstance(event, _TCE):
                    for result in (event.content if hasattr(event.content, "__iter__") else []):
                        if getattr(result, "is_error", False):
                            self._ctx._tool_errors += 1
                        elif isinstance(result, dict) and result.get("is_error"):
                            self._ctx._tool_errors += 1
            except (ImportError, TypeError, AttributeError):
                # Fallback: check is_error directly on content items
                content = getattr(event, "content", None)
                if content:
                    results = content if isinstance(content, list) else [content]
                    for r in results:
                        if getattr(r, "is_error", False):
                            self._ctx._tool_errors += 1

        elif cls_name == "TaskResult" or hasattr(event, "stop_reason"):
            # INT-11: mark that a TaskResult was received
            self._ctx._saw_result = True
            stop = getattr(event, "stop_reason", None)
            if stop and "error" in str(stop).lower():
                self._ctx._status = "failed"
                self._ctx._error  = str(stop)[:500]
            else:
                self._ctx._status = "success"
