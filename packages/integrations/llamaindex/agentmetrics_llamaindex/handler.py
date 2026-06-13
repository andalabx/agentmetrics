from __future__ import annotations

import time
import uuid
from typing import Any

from agentmetrics.http_client import HttpClient
from agentmetrics.tracker import _estimate_cost
from llama_index.core.instrumentation.event_handlers import BaseEventHandler
from llama_index.core.instrumentation.events import BaseEvent
from llama_index.core.instrumentation.events.agent import (
    AgentToolCallEvent,
)
from llama_index.core.instrumentation.events.llm import (
    LLMChatEndEvent,
    LLMCompletionEndEvent,
)
from llama_index.core.instrumentation.span import SimpleSpan
from llama_index.core.instrumentation.span_handlers import BaseSpanHandler


class _RunState:
    __slots__ = (
        "agent_id",
        "cache_read_tokens",
        "cache_write_tokens",
        "error",
        "input_tokens",
        "llm_calls",
        "model",
        "output_tokens",
        "span_id",
        "start_ms",
        "status",
        "tool_calls",
        "tool_errors",
        "tool_names",
    )

    def __init__(self, agent_id: str, span_id: str) -> None:
        self.agent_id  = agent_id
        self.span_id   = span_id
        self.start_ms  = time.monotonic()
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


def _extract_tokens(response: Any) -> tuple[int, int, int, int, str | None]:
    """Return (input, output, cache_read, cache_write, model) from any LLM response."""
    inp = out = cr = cw = 0
    model = None
    raw = getattr(response, "raw", None)
    if raw:
        if hasattr(raw, "get"):
            usage = raw.get("usage") or {}
            inp   = usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0) or 0
            out   = usage.get("completion_tokens", 0) or usage.get("output_tokens", 0) or 0
            cr    = usage.get("cache_read_input_tokens", 0) or 0
            cw    = usage.get("cache_creation_input_tokens", 0) or 0
            model = raw.get("model")
        else:
            u = getattr(raw, "usage", None)
            if u:
                inp = getattr(u, "prompt_tokens", 0) or getattr(u, "input_tokens", 0) or 0
                out = getattr(u, "completion_tokens", 0) or getattr(u, "output_tokens", 0) or 0
                cr  = getattr(u, "cache_read_input_tokens", 0) or 0
                cw  = getattr(u, "cache_creation_input_tokens", 0) or 0
            model = getattr(raw, "model", None)
    # fallback: additional_kwargs
    if not inp:
        ak    = getattr(response, "additional_kwargs", {}) or {}
        usage = ak.get("usage") or {}
        inp   = usage.get("input_tokens", 0) or 0
        out   = usage.get("output_tokens", 0) or 0
        cr    = usage.get("cache_read_input_tokens", 0) or 0
        cw    = usage.get("cache_creation_input_tokens", 0) or 0
    return inp, out, cr, cw, model


class AgentMetricsEventHandler(BaseEventHandler):
    """
    LlamaIndex instrumentation event handler - accumulates per-run state
    and delegates emission to the paired span handler.
    """

    def __init__(self, span_handler: AgentMetricsSpanHandler) -> None:
        self._sh = span_handler

    def handle(self, event: BaseEvent) -> None:
        span_id = getattr(event, "span_id", None) or ""
        state   = self._sh._find_run(span_id)
        if state is None:
            return

        if isinstance(event, (LLMChatEndEvent, LLMCompletionEndEvent)):
            state.llm_calls += 1
            response = getattr(event, "response", None)
            if response:
                inp, out, cr, cw, model = _extract_tokens(response)
                state.input_tokens       += inp
                state.output_tokens      += out
                state.cache_read_tokens  += cr
                state.cache_write_tokens += cw
                if not state.model and model:
                    state.model = model

        elif isinstance(event, AgentToolCallEvent):
            state.tool_calls += 1
            tool_meta = getattr(event, "tool", None)
            if tool_meta:
                name = getattr(tool_meta, "name", None)
                if name:
                    state.tool_names.add(name)


class AgentMetricsSpanHandler(BaseSpanHandler[SimpleSpan]):
    """
    LlamaIndex instrumentation span handler - tracks top-level agent spans
    and emits AgentMetrics events when they complete.
    """

    def __init__(
        self,
        api_key: str,
        agent_id: str = "llamaindex-agent",
        base_url: str = "http://localhost:8099",
    ) -> None:
        super().__init__()
        self._client    = HttpClient(api_key=api_key, base_url=base_url)
        self._agent_id  = agent_id
        # span_id → RunState (only for top-level agent spans)
        self._runs: dict[str, _RunState] = {}

    def _find_run(self, span_id: str) -> _RunState | None:
        """Walk up the span hierarchy to find a tracked RunState."""
        sid = span_id
        seen: set[str] = set()
        while sid and sid not in seen:
            seen.add(sid)
            if sid in self._runs:
                return self._runs[sid]
            # SimpleSpan parent tracking via span map
            span = self.open_spans.get(sid)
            if span is None:
                break
            sid = getattr(span, "parent_id", None) or ""
        return None

    def new_span(
        self,
        id_: str,
        bound_args: Any,
        instance: Any,
        parent_span_id: str | None = None,
        tags: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> SimpleSpan | None:
        # Only track top-level spans (no parent) that come from agent operations
        if parent_span_id is None and self._is_agent_span(instance):
            agent_name = getattr(instance, "name", None) or self._agent_id
            self._runs[id_] = _RunState(agent_name, id_)
        return SimpleSpan(id_=id_, parent_id=parent_span_id)

    def prepare_to_exit_span(
        self,
        id_: str,
        bound_args: Any,
        instance: Any,
        result: Any = None,
        **kwargs: Any,
    ) -> SimpleSpan | None:
        state = self._runs.pop(id_, None)
        if state:
            self._emit(state, id_, success=True)
        return self.open_spans.get(id_)

    def prepare_to_drop_span(
        self,
        id_: str,
        bound_args: Any,
        instance: Any,
        err: Exception | None = None,
        **kwargs: Any,
    ) -> SimpleSpan | None:
        state = self._runs.pop(id_, None)
        if state:
            state.status = "failed"
            state.error  = str(err)[:500] if err else None
            self._emit(state, id_, success=False)
        return self.open_spans.get(id_)

    @staticmethod
    def _is_agent_span(instance: Any) -> bool:
        cls_name = type(instance).__name__.lower()
        return any(kw in cls_name for kw in ("agent", "engine", "runner", "query"))

    def _emit(self, state: _RunState, trace_id: str, success: bool) -> None:
        duration_ms = (time.monotonic() - state.start_ms) * 1000
        est = _estimate_cost(
            state.model,
            state.input_tokens, state.output_tokens,
            state.cache_read_tokens, state.cache_write_tokens,
        )
        payload: dict[str, Any] = {
            "event_id":                 str(uuid.uuid4()),
            "trace_id":                 trace_id,
            "agent_id":                 state.agent_id,
            "platform":                 "llamaindex",
            "event_name":               "agent_end",
            "ts":                       int(time.time() * 1000),
            "redaction_policy_version": "v1-strict",
            "status":      state.status,
            "duration_ms": round(duration_ms, 2),
            "tool_calls":  state.tool_calls,
            "tool_errors": state.tool_errors,
            "tool_names":  list(state.tool_names),
            "llm_calls":   state.llm_calls,
            "input_tokens":  state.input_tokens,
            "output_tokens": state.output_tokens,
        }
        if state.model:
            payload["model"] = state.model
        if state.error:
            payload["error"] = state.error
        if state.cache_read_tokens:
            payload["cache_read_tokens"] = state.cache_read_tokens
        if state.cache_write_tokens:
            payload["cache_write_tokens"] = state.cache_write_tokens
        if est is not None:
            payload["estimated_cost_usd"] = est
        self._client.fire_and_forget(payload)

    def flush(self, timeout: float = 10.0) -> None:
        self._client.flush(timeout=timeout)


def instrument(
    api_key: str,
    agent_id: str = "llamaindex-agent",
    base_url: str = "http://localhost:8099",
) -> AgentMetricsSpanHandler:
    """
    Register AgentMetrics handlers on the global LlamaIndex root dispatcher.

    Usage::

        from agentmetrics_llamaindex import instrument

        span_handler = instrument(api_key="am_...")
        # Run your LlamaIndex agents normally - events are captured automatically.
        span_handler.flush()
    """
    from llama_index.core.instrumentation import root_dispatcher

    span_handler  = AgentMetricsSpanHandler(api_key=api_key, agent_id=agent_id, base_url=base_url)
    event_handler = AgentMetricsEventHandler(span_handler=span_handler)

    root_dispatcher.add_span_handler(span_handler)
    root_dispatcher.add_event_handler(event_handler)

    return span_handler
