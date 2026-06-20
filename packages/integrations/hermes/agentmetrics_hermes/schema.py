from __future__ import annotations

import hashlib
import time
from typing import Any

from .events import (
    AgentEndEvent,
    ApiErrorEvent,
    AuditEvent,
    CronEndEvent,
    CronStartEvent,
    GatewayConnectEvent,
    GatewayDisconnectEvent,
    LlmInputEvent,
    LlmOutputEvent,
    MemoryWriteEvent,
    SessionMetricsEvent,
    SessionStartEvent,
    SkillLoadEvent,
    SubagentSpawnEvent,
    ToolEndEvent,
    ToolStartEvent,
)

_MAX_STRING_LEN = 2000  # cap free-text fields before sending (SEC-D04)
_MAX_TOOL_NAMES = 200   # cap tool names list length


def _cap(value: str, limit: int = _MAX_STRING_LEN) -> str:
    return value[:limit] if len(value) > limit else value


def _hash_set(names: set[str]) -> str:
    """Stable hash of a set of strings — used for skill_names_hash."""
    joined = ",".join(sorted(names))
    return hashlib.sha256(joined.encode()).hexdigest()[:16]


def session_start_to_payload(ev: SessionStartEvent) -> dict[str, Any]:
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "status": "success",
        "redaction_policy_version": ev.redaction_policy_version,
    }


def session_metrics_to_payload(ev: SessionMetricsEvent) -> dict[str, Any]:
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "status": "success",
        "redaction_policy_version": ev.redaction_policy_version,
        "duration_ms": max(0, ev.duration_ms),
        "run_count": ev.run_count,
        "input_tokens": ev.total_input_tokens,
        "output_tokens": ev.total_output_tokens,
        "cache_read_tokens": ev.total_cache_read_tokens,
        "cache_write_tokens": ev.total_cache_write_tokens,
        "tool_calls": ev.total_tool_calls,
        "estimated_cost_usd": ev.total_estimated_cost_usd,
        "metadata": {"compactions": ev.compactions, "resets": ev.resets},
    }


def agent_end_to_payload(ev: AgentEndEvent) -> dict[str, Any]:
    tool_names = [_cap(n, 255) for n in ev.tool_names[:_MAX_TOOL_NAMES]]
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "run_id": _cap(ev.run_id, 255),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "redaction_policy_version": ev.redaction_policy_version,
        "status": ev.status,
        "duration_ms": max(0, ev.duration_ms),
        "model": _cap(ev.model, 200),
        "model_provider": _cap(ev.model_provider, 100),
        "input_tokens": max(0, ev.input_tokens),
        "output_tokens": max(0, ev.output_tokens),
        "cache_read_tokens": max(0, ev.cache_read_tokens),
        "cache_write_tokens": max(0, ev.cache_write_tokens),
        "total_tokens": max(0, ev.total_tokens),
        "tool_calls": min(max(0, ev.tool_calls), 1_000_000),
        "tool_errors": min(max(0, ev.tool_errors), 1_000_000),
        "tool_names": tool_names,
        "estimated_cost_usd": ev.estimated_cost_usd,
        "step_count": ev.step_count,
        "llm_calls": ev.llm_calls,
        "skills_loaded_count": ev.skills_loaded_count,
        "skill_names_hash": ev.skill_names_hash,
        "memory_writes_count": ev.memory_writes_count,
        "session_search_calls": ev.session_search_calls,
        "delegation_depth": ev.delegation_depth,
        "cronjob_id": ev.cronjob_id,
        "cron_run_id": ev.cron_run_id,
        "error": _cap(ev.error) if ev.error else "",
        "span_id": ev.span_id,
        "parent_span_id": ev.parent_span_id,
        "secrets_blocked_count": max(0, ev.secrets_blocked_count),
        "pii_detected_count": max(0, ev.pii_detected_count),
        "metadata": ev.metadata,
    }


def tool_start_to_payload(ev: ToolStartEvent) -> dict[str, Any]:
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "run_id": _cap(ev.run_id, 255),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "status": "success",
        "redaction_policy_version": ev.redaction_policy_version,
        "tool_name": _cap(ev.tool_name, 255),
        "tool_call_id": _cap(ev.tool_call_id, 255),
        "span_id": ev.span_id,
        "parent_span_id": ev.parent_span_id,
    }


def tool_end_to_payload(ev: ToolEndEvent) -> dict[str, Any]:
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "run_id": _cap(ev.run_id, 255),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "redaction_policy_version": ev.redaction_policy_version,
        "tool_name": _cap(ev.tool_name, 255),
        "tool_call_id": _cap(ev.tool_call_id, 255),
        "duration_ms": max(0, ev.duration_ms),
        "status": ev.status,
        "error": _cap(ev.error) if ev.error else "",
        "span_id": ev.span_id,
        "parent_span_id": ev.parent_span_id,
    }


def llm_input_to_payload(ev: LlmInputEvent) -> dict[str, Any]:
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "run_id": _cap(ev.run_id, 255),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "status": "success",
        "redaction_policy_version": ev.redaction_policy_version,
        "model": _cap(ev.model, 200),
        "model_provider": _cap(ev.provider, 100),
        "images_count": ev.images_count,
        "span_id": ev.span_id,
    }


def llm_output_to_payload(ev: LlmOutputEvent) -> dict[str, Any]:
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "run_id": _cap(ev.run_id, 255),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "status": "success",
        "redaction_policy_version": ev.redaction_policy_version,
        "model": _cap(ev.model, 200),
        "model_provider": _cap(ev.provider, 100),
        "input_tokens": max(0, ev.input_tokens),
        "output_tokens": max(0, ev.output_tokens),
        "cache_read_tokens": max(0, ev.cache_read_tokens),
        "cache_write_tokens": max(0, ev.cache_write_tokens),
        "finish_reason": ev.finish_reason,
        "estimated_cost_usd": ev.estimated_cost_usd,
        "span_id": ev.span_id,
    }


def api_error_to_payload(ev: ApiErrorEvent) -> dict[str, Any]:
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "run_id": _cap(ev.run_id, 255),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "status": "failed",
        "redaction_policy_version": ev.redaction_policy_version,
        "model": _cap(ev.model, 200),
        "model_provider": _cap(ev.provider, 100),
        "error": _cap(ev.error_message),
    }


def audit_to_payload(ev: AuditEvent) -> dict[str, Any]:
    return {
        "event_id": ev.event_id,
        "trace_id": ev.trace_id,
        "session_id": _cap(ev.session_id),
        "agent_id": _cap(ev.agent_id),
        "platform": ev.platform,
        "event_name": ev.event_name,
        "ts": ev.ts,
        "status": ev.status,
        "metadata": ev.metadata,
    }


def generic_to_payload(ev: Any) -> dict[str, Any]:
    """Fallback serializer for stub event types (cron, gateway, skills, memory, subagents)."""
    payload: dict[str, Any] = {}
    for attr in vars(ev):
        val = getattr(ev, attr)
        if isinstance(val, (str, int, float, bool, list, dict)) or val is None:
            payload[attr] = val
    return payload
