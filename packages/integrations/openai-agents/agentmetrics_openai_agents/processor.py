from __future__ import annotations

import time
import uuid
from typing import Any

from agentmetrics.http_client import HttpClient
from agentmetrics.tracker import _estimate_cost
from agents.tracing import Span, Trace, TracingProcessor
from agents.tracing.spans import (
    AgentSpanData,
    FunctionSpanData,
    HandoffSpanData,
    LLMSpanData,
)


class _TraceState:
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
    )

    def __init__(self, agent_id: str) -> None:
        self.agent_id  = agent_id
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


class AgentMetricsProcessor(TracingProcessor):
    """
    OpenAI Agents SDK tracing processor that sends run summaries to AgentMetrics.

    Add once globally - covers all agents in the process.

    Usage::

        from agents.tracing import add_trace_processor
        from agentmetrics_openai_agents import AgentMetricsProcessor

        add_trace_processor(AgentMetricsProcessor(api_key="am_..."))
    """

    def __init__(
        self,
        api_key: str,
        agent_id: str = "openai-agent",
        base_url: str = "http://localhost:8099",
    ) -> None:
        self._client   = HttpClient(api_key=api_key, base_url=base_url)
        self._agent_id = agent_id
        # trace_id (str) → _TraceState
        self._traces: dict[str, _TraceState] = {}


    def on_trace_start(self, trace: Trace) -> None:
        agent_name = getattr(trace, "name", None) or self._agent_id
        self._traces[trace.trace_id] = _TraceState(agent_name)

    def on_trace_end(self, trace: Trace) -> None:
        state = self._traces.pop(trace.trace_id, None)
        if state is None:
            return
        if getattr(trace, "error", None):
            state.status = "failed"
            state.error  = str(trace.error)[:500]
        self._emit(state, trace.trace_id)


    def on_span_start(self, span: Span[Any]) -> None:
        pass

    def on_span_end(self, span: Span[Any]) -> None:
        state = self._traces.get(span.trace_id)
        if state is None:
            return

        data = span.span_data

        if isinstance(data, LLMSpanData):
            state.llm_calls += 1
            usage = getattr(data, "usage", None) or {}
            if hasattr(usage, "input_tokens"):
                state.input_tokens  += getattr(usage, "input_tokens", 0) or 0
                state.output_tokens += getattr(usage, "output_tokens", 0) or 0
                # OpenAI Agents SDK stores cached tokens in input_tokens_details
                details = getattr(usage, "input_tokens_details", None) or {}
                if hasattr(details, "cached_tokens"):
                    state.cache_read_tokens += getattr(details, "cached_tokens", 0) or 0
                elif hasattr(details, "get"):
                    state.cache_read_tokens += details.get("cached_tokens", 0) or 0
            elif isinstance(usage, dict):
                state.input_tokens  += usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0) or 0
                state.output_tokens += usage.get("output_tokens", 0) or usage.get("completion_tokens", 0) or 0
            if not state.model:
                resp = getattr(data, "output", None)
                if resp:
                    state.model = getattr(resp, "model", None)

        elif isinstance(data, FunctionSpanData):
            state.tool_calls += 1
            name = getattr(data, "name", None)
            if name:
                state.tool_names.add(name)
            if getattr(span, "error", None):
                state.tool_errors += 1

        elif isinstance(data, HandoffSpanData):
            state.tool_calls += 1

        elif isinstance(data, AgentSpanData):
            # agent-level errors bubble up to trace; nothing extra here
            pass


    def force_flush(self) -> None:
        self._client.flush(timeout=10.0)

    def shutdown(self) -> None:
        self.force_flush()


    def _emit(self, state: _TraceState, trace_id: str) -> None:
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
            "platform":                 "openai-agents",
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
