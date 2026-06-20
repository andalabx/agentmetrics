from __future__ import annotations

import logging
import time
from typing import Any

from .config import AgentMetricsConfig
from .events import (
    AgentEndEvent,
    ApiErrorEvent,
    AuditEvent,
    CancelEvent,
    CronEndEvent,
    CronStartEvent,
    FailureEvent,
    GatewayConnectEvent,
    GatewayDisconnectEvent,
    GatewayReconnectEvent,
    LlmInputEvent,
    LlmOutputEvent,
    MemoryWriteEvent,
    RetryEvent,
    SessionMetricsEvent,
    SessionSearchEvent,
    SessionStartEvent,
    SkillLoadEvent,
    SubagentEndEvent,
    SubagentSpawnEvent,
    TimeoutEvent,
    ToolEndEvent,
    ToolStartEvent,
)
from .pipeline import EventPipeline
from .redact import (
    RedactionMode,
    active_mode,
    redact_tool_name,
    redaction_policy_version,
    scrub_event_and_count,
)
from .schema import (
    _hash_set,
    agent_end_to_payload,
    api_error_to_payload,
    audit_to_payload,
    generic_to_payload,
    llm_input_to_payload,
    llm_output_to_payload,
    session_metrics_to_payload,
    session_start_to_payload,
    tool_end_to_payload,
    tool_start_to_payload,
)
from .state import StateStore

logger = logging.getLogger(__name__)

# Use Hermes's own authoritative pricing when running inside Hermes.
# Falls back to None (no guessing) when not available (e.g. unit tests).
try:
    from agent.usage_pricing import CanonicalUsage as _CanonicalUsage
    from agent.usage_pricing import estimate_usage_cost as _estimate_usage_cost
    _HERMES_PRICING = True
except ImportError:
    _HERMES_PRICING = False

# Sentinel used in pre_tool_call to track per-call start times.
_TOOL_START_TIMES: dict[str, float] = {}
_LLM_START_TIMES: dict[str, float] = {}


def _infer_provider(model: str) -> str:
    model_lower = model.lower()
    if model_lower.startswith("claude"):
        return "anthropic"
    if model_lower.startswith("gpt") or model_lower.startswith("o1") or model_lower.startswith("o3"):
        return "openai"
    if model_lower.startswith("gemini"):
        return "google"
    if model_lower.startswith("deepseek"):
        return "deepseek"
    if model_lower.startswith("llama"):
        return "meta"
    if model_lower.startswith("qwen"):
        return "alibaba"
    return "unknown"


def _normalize_status(raw: str | None) -> str:
    """Map Hermes internal status values to the AgentMetrics event schema enum."""
    mapping = {
        "ok": "success",
        "success": "success",
        "error": "failed",
        "failed": "failed",
        "timeout": "timeout",
        "cancelled": "canceled",
        "canceled": "canceled",
        "killed": "killed",
    }
    return mapping.get((raw or "").lower(), "success")


class AgentMetricsHooks:
    """All Hermes hook handlers for the AgentMetrics observability plugin."""

    def __init__(self, cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore) -> None:
        self._cfg = cfg
        self._pipeline = pipeline
        self._store = store
        self._last_redaction_mode: RedactionMode | None = None

    # ── Session lifecycle ─────────────────────────────────────────────────────

    def on_session_start(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or kwargs.get("session_key") or "unknown")
        agent_id = str(kwargs.get("agent_id") or "hermes")
        mode = active_mode(self._cfg)

        session = self._store.get_or_create_session(session_key, agent_id=agent_id)

        ev = SessionStartEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            agent_id=agent_id,
            redaction_policy_version=redaction_policy_version(mode),
        )
        self._enqueue(session_start_to_payload(ev), mode)

    def on_session_end(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or kwargs.get("session_key") or "unknown")
        mode = active_mode(self._cfg)

        # If a run is still active when the session ends, close it out.
        run = self._store.finish_run(session_key)
        if run:
            # Increment run_count before emitting so session_metrics reflects this final run.
            existing = self._store.get_session(session_key)
            if existing:
                existing.run_count += 1
            self._emit_agent_end(session_key, run, status="success", mode=mode)

        session = self._store.pop_session(session_key)
        if not session:
            return

        duration_ms = int((time.time() - session.started_at) * 1000)
        ev = SessionMetricsEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            agent_id=session.agent_id,
            redaction_policy_version=redaction_policy_version(mode),
            duration_ms=duration_ms,
            run_count=session.run_count,
            total_input_tokens=session.total_input_tokens,
            total_output_tokens=session.total_output_tokens,
            total_cache_read_tokens=session.total_cache_read_tokens,
            total_cache_write_tokens=session.total_cache_write_tokens,
            total_tool_calls=session.total_tool_calls,
            total_estimated_cost_usd=session.total_estimated_cost_usd,
            compactions=session.compactions,
            resets=session.resets,
        )
        self._enqueue(session_metrics_to_payload(ev), mode)

    # ── LLM call tracking ─────────────────────────────────────────────────────

    def pre_llm_call(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or kwargs.get("session_key") or "unknown")
        # Ensure a run exists for this turn — creates one if needed.
        self._store.get_or_create_run(session_key)

    def post_llm_call(self, **kwargs: Any) -> None:
        # Hermes fires this after the logical LLM step. We track at pre/post_api_request level
        # for token counts, so this hook is a no-op unless it carries additional info.
        pass

    def pre_api_request(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or kwargs.get("session_key") or "unknown")
        model = str(kwargs.get("model") or "")
        provider = str(kwargs.get("provider") or _infer_provider(model))
        images = int(kwargs.get("images_count") or 0)
        mode = active_mode(self._cfg)

        run = self._store.get_or_create_run(session_key)
        run.llm_calls += 1
        run.step_count += 1
        if model and not run.model:
            run.model = model
            run.provider = provider
        if model:
            run.model = model
            run.provider = provider

        span_id = self._store.start_span(run.run_id)
        # Store span so post_api_request can find it by session.
        _LLM_START_TIMES[f"{session_key}:{span_id}"] = time.time()

        session = self._store.get_or_create_session(session_key)
        ev = LlmInputEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id,
            agent_id=session.agent_id,
            model=model,
            provider=provider,
            images_count=images,
            span_id=span_id,
            redaction_policy_version=redaction_policy_version(mode),
        )
        self._enqueue(llm_input_to_payload(ev), mode)

    def post_api_request(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or kwargs.get("session_key") or "unknown")
        model = str(kwargs.get("model") or "")
        provider = str(kwargs.get("provider") or _infer_provider(model))
        usage: dict[str, Any] = kwargs.get("usage") or {}
        finish_reason = str(kwargs.get("finish_reason") or "")
        mode = active_mode(self._cfg)

        input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
        cache_read = int(usage.get("cache_read_input_tokens") or usage.get("cache_read_tokens") or 0)
        cache_write = int(usage.get("cache_creation_input_tokens") or usage.get("cache_write_tokens") or 0)

        if _HERMES_PRICING:
            _cu = _CanonicalUsage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read,
                cache_write_tokens=cache_write,
            )
            _result = _estimate_usage_cost(model, _cu, provider=provider)
            cost: float | None = float(_result.amount_usd) if _result.amount_usd is not None else None
        else:
            cost = None

        run = self._store.get_active_run(session_key)
        if run:
            run.input_tokens += input_tokens
            run.output_tokens += output_tokens
            run.cache_read_tokens += cache_read
            run.cache_write_tokens += cache_write

        session = self._store.get_or_create_session(session_key)
        session.total_input_tokens += input_tokens
        session.total_output_tokens += output_tokens
        session.total_cache_read_tokens += cache_read
        session.total_cache_write_tokens += cache_write
        if cost is not None:
            session.total_estimated_cost_usd += cost

        run_id = run.run_id if run else ""
        ev = LlmOutputEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run_id,
            agent_id=session.agent_id,
            model=model,
            provider=provider,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read,
            cache_write_tokens=cache_write,
            finish_reason=finish_reason,
            estimated_cost_usd=cost,
            redaction_policy_version=redaction_policy_version(mode),
        )
        self._enqueue(llm_output_to_payload(ev), mode)

        # A non-tool finish_reason signals end of this run's turn.
        if finish_reason in ("stop", "end_turn", "length", "max_tokens"):
            completed_run = self._store.finish_run(session_key)
            if completed_run:
                self._emit_agent_end(session_key, completed_run, status="success", mode=mode)
                session.run_count += 1

    def api_request_error(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or kwargs.get("session_key") or "unknown")
        model = str(kwargs.get("model") or "")
        provider = str(kwargs.get("provider") or _infer_provider(model))
        error_msg = str(kwargs.get("error") or kwargs.get("error_message") or "")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.last_error = error_msg[:2000]

        session = self._store.get_or_create_session(session_key)
        ev = ApiErrorEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            model=model,
            provider=provider,
            error_message=error_msg,
            redaction_policy_version=redaction_policy_version(mode),
        )
        self._enqueue(api_error_to_payload(ev), mode)

    # ── Tool call tracking ────────────────────────────────────────────────────

    def pre_tool_call(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or kwargs.get("session_key") or "unknown")
        tool_name_raw = str(kwargs.get("tool_name") or kwargs.get("name") or "")
        tool_call_id = str(kwargs.get("tool_call_id") or "")
        mode = active_mode(self._cfg)

        run = self._store.get_or_create_run(session_key)
        run.step_count += 1

        # Record tool start time for duration calculation in post_tool_call.
        call_key = f"{session_key}:{tool_call_id or tool_name_raw}"
        _TOOL_START_TIMES[call_key] = time.time()

        span_id = self._store.start_span(run.run_id)

        redacted_name = redact_tool_name(tool_name_raw, self._cfg)
        session = self._store.get_or_create_session(session_key)
        ev = ToolStartEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id,
            agent_id=session.agent_id,
            tool_name=redacted_name or "",
            tool_call_id=tool_call_id,
            span_id=span_id,
            redaction_policy_version=redaction_policy_version(mode),
        )
        # Stash span_id on the raw kwargs so post_tool_call can close it.
        kwargs["_am_span_id"] = span_id
        kwargs["_am_call_key"] = call_key
        self._enqueue(tool_start_to_payload(ev), mode)

    def post_tool_call(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or kwargs.get("session_key") or "unknown")
        tool_name_raw = str(kwargs.get("tool_name") or kwargs.get("name") or "")
        tool_call_id = str(kwargs.get("tool_call_id") or "")
        raw_status = str(kwargs.get("status") or "ok")
        error_msg = str(kwargs.get("error") or "")
        span_id = str(kwargs.get("_am_span_id") or "")
        call_key = str(
            kwargs.get("_am_call_key") or f"{session_key}:{tool_call_id or tool_name_raw}"
        )
        mode = active_mode(self._cfg)

        status = _normalize_status(raw_status)
        started = _TOOL_START_TIMES.pop(call_key, time.time())
        duration_ms = int((time.time() - started) * 1000)

        run = self._store.get_active_run(session_key)
        if run:
            run.tool_calls += 1
            if status == "failed":
                run.tool_errors += 1
            if error_msg:
                run.last_error = error_msg[:2000]
            redacted_name = redact_tool_name(tool_name_raw, self._cfg)
            if redacted_name:
                run.tool_names.add(redacted_name)

        session = self._store.get_or_create_session(session_key)
        session.total_tool_calls += 1

        ev = ToolEndEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            tool_name=redact_tool_name(tool_name_raw, self._cfg) or "",
            tool_call_id=tool_call_id,
            duration_ms=duration_ms,
            status=status,
            error=error_msg[:2000] if error_msg else "",
            span_id=span_id,
            redaction_policy_version=redaction_policy_version(mode),
        )
        self._enqueue(tool_end_to_payload(ev), mode)

    # ── Future hooks (stubs — wired when Hermes exposes the Python hook) ──────

    def on_subagent_spawn(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        child_key = str(kwargs.get("child_session_id") or kwargs.get("child_session_key") or "")
        depth = int(kwargs.get("delegation_depth") or 0)
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.subagents_spawned += 1
            run.delegation_depth = max(run.delegation_depth, depth)

        session = self._store.get_or_create_session(session_key)
        ev = SubagentSpawnEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            child_session_key=child_key,
            delegation_depth=depth,
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_skill_load(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        skill_name = str(kwargs.get("skill_name") or "")
        version = str(kwargs.get("version") or "")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.skills_loaded_count += 1
            run.skill_names.add(skill_name)

        session = self._store.get_or_create_session(session_key)
        ev = SkillLoadEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            skill_name=skill_name,
            version=version,
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_memory_write(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        key = str(kwargs.get("key") or "")
        value_type = str(kwargs.get("value_type") or type(kwargs.get("value")).__name__)
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.memory_writes_count += 1

        session = self._store.get_or_create_session(session_key)
        ev = MemoryWriteEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            key=key,
            value_type=value_type,
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_cron_start(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        cronjob_id = str(kwargs.get("cronjob_id") or "")
        cron_run_id = str(kwargs.get("cron_run_id") or "")
        schedule = str(kwargs.get("schedule") or "")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.cronjob_id = cronjob_id
            run.cron_run_id = cron_run_id

        session = self._store.get_or_create_session(session_key)
        ev = CronStartEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            agent_id=session.agent_id,
            cronjob_id=cronjob_id,
            cron_run_id=cron_run_id,
            schedule=schedule,
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_cron_end(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        mode = active_mode(self._cfg)

        session = self._store.get_or_create_session(session_key)
        ev = CronEndEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            agent_id=session.agent_id,
            cronjob_id=str(kwargs.get("cronjob_id") or ""),
            cron_run_id=str(kwargs.get("cron_run_id") or ""),
            status=_normalize_status(str(kwargs.get("status") or "ok")),
            error=str(kwargs.get("error") or "")[:2000],
            duration_ms=int(kwargs.get("duration_ms") or 0),
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_gateway_connect(self, **kwargs: Any) -> None:
        mode = active_mode(self._cfg)
        ev = GatewayConnectEvent(
            remote_id=str(kwargs.get("remote_id") or ""),
            protocol=str(kwargs.get("protocol") or ""),
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_gateway_disconnect(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.gateway_disconnects += 1

        ev = GatewayDisconnectEvent(
            remote_id=str(kwargs.get("remote_id") or ""),
            reason=str(kwargs.get("reason") or ""),
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_gateway_reconnect(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.reconnects += 1

        session = self._store.get_or_create_session(session_key)
        ev = GatewayReconnectEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            agent_id=session.agent_id,
            remote_id=str(kwargs.get("remote_id") or ""),
            attempt=int(kwargs.get("attempt") or 0),
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_subagent_end(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        outcome = _normalize_status(str(kwargs.get("outcome") or kwargs.get("status") or "ok"))
        error_msg = str(kwargs.get("error") or "")
        if run and outcome == "failed":
            run.subagent_errors += 1

        session = self._store.get_or_create_session(session_key)
        ev = SubagentEndEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            target_session_key=str(kwargs.get("child_session_id") or kwargs.get("target_session_key") or ""),
            outcome=outcome,
            error=error_msg[:2000],
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_session_search(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.session_search_calls += 1

        session = self._store.get_or_create_session(session_key)
        ev = SessionSearchEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            query=str(kwargs.get("query") or ""),
            results_count=int(kwargs.get("results_count") or 0),
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_retry(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        session = self._store.get_or_create_session(session_key)
        ev = RetryEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            reason=str(kwargs.get("reason") or ""),
            attempt=int(kwargs.get("attempt") or 0),
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_timeout(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        session = self._store.get_or_create_session(session_key)
        ev = TimeoutEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            duration_ms=int(kwargs.get("duration_ms") or 0),
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_cancel(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        session = self._store.get_or_create_session(session_key)
        ev = CancelEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            reason=str(kwargs.get("reason") or ""),
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_failure(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        error_msg = str(kwargs.get("error") or "")
        mode = active_mode(self._cfg)

        run = self._store.get_active_run(session_key)
        if run:
            run.last_error = error_msg[:2000]

        session = self._store.get_or_create_session(session_key)
        ev = FailureEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id if run else "",
            agent_id=session.agent_id,
            error=error_msg[:2000],
        )
        self._enqueue(generic_to_payload(ev), mode)

    def on_before_compaction(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        session = self._store.get_session(session_key)
        if session:
            session.compactions += 1

    def on_before_reset(self, **kwargs: Any) -> None:
        session_key = str(kwargs.get("session_id") or "unknown")
        session = self._store.get_session(session_key)
        if session:
            session.resets += 1

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _emit_agent_end(
        self, session_key: str, run: Any, status: str, mode: RedactionMode
    ) -> None:
        """Serialize a completed RunState into an agent_end event and enqueue it."""
        session = self._store.get_or_create_session(session_key)
        duration_ms = int((time.time() - run.started_at) * 1000)
        total_tokens = run.input_tokens + run.output_tokens + run.cache_read_tokens + run.cache_write_tokens
        if _HERMES_PRICING:
            _cu = _CanonicalUsage(
                input_tokens=run.input_tokens,
                output_tokens=run.output_tokens,
                cache_read_tokens=run.cache_read_tokens,
                cache_write_tokens=run.cache_write_tokens,
            )
            _result = _estimate_usage_cost(run.model, _cu, provider=run.provider)
            cost: float | None = float(_result.amount_usd) if _result.amount_usd is not None else None
        else:
            cost = None
        if cost is not None:
            session.total_estimated_cost_usd += cost

        tool_names_list = [redact_tool_name(n, self._cfg) or n for n in run.tool_names]
        skill_hash = _hash_set(run.skill_names) if run.skill_names else ""

        ev = AgentEndEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            run_id=run.run_id,
            agent_id=session.agent_id,
            redaction_policy_version=redaction_policy_version(mode),
            status=status,
            duration_ms=duration_ms,
            model=run.model,
            model_provider=run.provider,
            input_tokens=run.input_tokens,
            output_tokens=run.output_tokens,
            cache_read_tokens=run.cache_read_tokens,
            cache_write_tokens=run.cache_write_tokens,
            total_tokens=total_tokens,
            tool_calls=run.tool_calls,
            tool_errors=run.tool_errors,
            tool_names=tool_names_list,
            estimated_cost_usd=cost,
            step_count=run.step_count,
            llm_calls=run.llm_calls,
            skills_loaded_count=run.skills_loaded_count,
            skill_names_hash=skill_hash,
            memory_writes_count=run.memory_writes_count,
            session_search_calls=run.session_search_calls,
            delegation_depth=run.delegation_depth,
            cronjob_id=run.cronjob_id,
            cron_run_id=run.cron_run_id,
            error=run.last_error,
            secrets_blocked_count=run.secrets_blocked,
            pii_detected_count=0,
            metadata={
                "llm_calls": run.llm_calls,
                "images_count": run.images_count,
                "subagents_spawned": run.subagents_spawned,
                "subagent_errors": run.subagent_errors,
                "gateway_disconnects": run.gateway_disconnects,
                "reconnects": run.reconnects,
                "compactions": session.compactions,
                "resets": session.resets,
            },
        )
        payload = agent_end_to_payload(ev)
        self._enqueue(payload, mode)

    def _check_redaction_mode_change(self, mode: RedactionMode, session_key: str) -> None:
        if self._last_redaction_mode is None:
            self._last_redaction_mode = mode
            return
        if self._last_redaction_mode == mode:
            return
        prev = self._last_redaction_mode
        self._last_redaction_mode = mode
        session = self._store.get_or_create_session(session_key or "unknown")
        ev = AuditEvent(
            trace_id=session.trace_id,
            session_id=session_key,
            agent_id=session.agent_id,
            event_name="audit_redaction_change",
            metadata={"previous_mode": prev.value, "new_mode": mode.value},
        )
        # Direct pipeline enqueue — bypasses _enqueue() to avoid recursion.
        self._pipeline.enqueue(audit_to_payload(ev))

    def _enqueue(self, payload: dict[str, Any], mode: RedactionMode) -> None:
        """Scrub secrets, accumulate blocked-secret count, then push to pipeline. Never raises."""
        try:
            session_key = str(payload.get("session_id") or "")
            self._check_redaction_mode_change(mode, session_key)
            scrubbed, count = scrub_event_and_count(payload, mode)
            if count and session_key:
                run = self._store.get_active_run(session_key)
                if run:
                    run.secrets_blocked += count
            self._pipeline.enqueue(scrubbed)
        except Exception:
            logger.exception("agentmetrics: failed to enqueue event")
