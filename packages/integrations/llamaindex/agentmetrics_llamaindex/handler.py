from __future__ import annotations

import time
from typing import Any

from agentmetrics.http_client import HttpClient
from agentmetrics_shared import AgentEndEvent, estimate_cost
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


# INT-05: multi-path token extraction helper
def _extract_tokens(response: Any) -> dict:
    """Return a dict with token counts extracted from any known LlamaIndex response shape."""
    for path in [
        lambda r: getattr(r, "raw", {}).get("usage") if hasattr(r, "raw") and hasattr(getattr(r, "raw", None), "get") else None,
        lambda r: getattr(r, "additional_kwargs", {}).get("usage"),
        lambda r: getattr(r, "usage", None),
        lambda r: (getattr(r, "metadata", None) or {}).get("usage"),
    ]:
        try:
            usage = path(response)
            if usage and isinstance(usage, dict):
                return {
                    "input_tokens": usage.get("prompt_tokens") or usage.get("input_tokens", 0),
                    "output_tokens": usage.get("completion_tokens") or usage.get("output_tokens", 0),
                    "cache_read_tokens": usage.get("cache_read_input_tokens"),
                    "cache_write_tokens": usage.get("cache_creation_input_tokens"),
                    "model": None,
                }
            if usage and hasattr(usage, "prompt_tokens"):
                return {
                    "input_tokens": getattr(usage, "prompt_tokens", 0),
                    "output_tokens": getattr(usage, "completion_tokens", 0),
                    "cache_read_tokens": None,
                    "cache_write_tokens": None,
                    "model": None,
                }
        except (AttributeError, TypeError):
            continue

    # Final fallback: try raw as object with usage attribute
    try:
        raw = getattr(response, "raw", None)
        if raw and not hasattr(raw, "get"):
            u = getattr(raw, "usage", None)
            if u:
                return {
                    "input_tokens": getattr(u, "prompt_tokens", 0) or getattr(u, "input_tokens", 0) or 0,
                    "output_tokens": getattr(u, "completion_tokens", 0) or getattr(u, "output_tokens", 0) or 0,
                    "cache_read_tokens": getattr(u, "cache_read_input_tokens", None),
                    "cache_write_tokens": getattr(u, "cache_creation_input_tokens", None),
                    "model": getattr(raw, "model", None),
                }
    except (AttributeError, TypeError):
        pass

    return {}


# INT-06: bounded root span cache (LRU) — evicts oldest entries beyond MAX_CACHE_SIZE
_MAX_CACHE_SIZE = 4096
_root_cache: dict[str, str] = {}


def _find_root(span_id: str, spans: dict, _visited: set | None = None) -> str:
    """Walk up the span hierarchy to find the root, with caching and cycle protection."""
    if span_id in _root_cache:
        return _root_cache[span_id]
    if _visited is None:
        _visited = set()
    if span_id in _visited:
        return span_id  # cycle guard
    _visited.add(span_id)
    span = spans.get(span_id)
    parent = span.parent_id if span is not None else None
    if not parent or parent not in spans:
        _cache_put(span_id, span_id)
        return span_id
    root = _find_root(parent, spans, _visited)
    _cache_put(span_id, root)
    return root


def _cache_put(key: str, value: str) -> None:
    if len(_root_cache) >= _MAX_CACHE_SIZE:
        # Evict the oldest entry (dict preserves insertion order in Python 3.7+)
        _root_cache.pop(next(iter(_root_cache)))
    _root_cache[key] = value


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
                tokens = _extract_tokens(response)
                state.input_tokens       += tokens.get("input_tokens") or 0
                state.output_tokens      += tokens.get("output_tokens") or 0
                cr = tokens.get("cache_read_tokens")
                cw = tokens.get("cache_write_tokens")
                if cr is not None:
                    state.cache_read_tokens  += cr
                if cw is not None:
                    state.cache_write_tokens += cw
                if not state.model and tokens.get("model"):
                    state.model = tokens["model"]

        elif isinstance(event, AgentToolCallEvent):
            state.tool_calls += 1
            tool_meta = getattr(event, "tool", None)
            if tool_meta:
                name = getattr(tool_meta, "name", None)
                if name:
                    state.tool_names.add(name)

        # INT-07: extract tool errors from the exception field in tool call events
        payload = getattr(event, "payload", None)
        if payload is not None and isinstance(payload, dict) and payload.get("exception") is not None:
            state.tool_errors = getattr(state, "tool_errors", 0) + 1


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
        ev = AgentEndEvent(agent_id=state.agent_id, platform="llamaindex")
        ev.trace_id           = trace_id
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
        self._client.fire_and_forget(ev.to_payload())

    def flush(self, timeout: float = 10.0) -> None:
        self._client.flush(timeout=timeout)


# INT-08: append to existing callback manager instead of replacing it
def register_handler(handler: Any) -> None:
    """Register a LlamaIndex handler without clobbering an existing callback manager."""
    try:
        from llama_index.core import Settings
        if Settings.callback_manager is None:
            from llama_index.core.callbacks import CallbackManager
            Settings.callback_manager = CallbackManager([handler])
        else:
            Settings.callback_manager.add_handler(handler)
    except (ImportError, AttributeError):
        pass  # older LlamaIndex versions


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
