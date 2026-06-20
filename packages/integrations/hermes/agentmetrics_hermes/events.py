from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


def _now_ms() -> int:
    return int(time.time() * 1000)


def _new_id() -> str:
    return str(uuid.uuid4())


@dataclass
class SessionStartEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "session_start"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"


@dataclass
class SessionMetricsEvent:
    """Fired once at session end — aggregates all runs in the session."""

    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "session_metrics"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"

    duration_ms: int = 0
    run_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cache_read_tokens: int = 0
    total_cache_write_tokens: int = 0
    total_tool_calls: int = 0
    total_estimated_cost_usd: float | None = None
    compactions: int = 0
    resets: int = 0


@dataclass
class AgentEndEvent:
    """Fired at the end of each run (turn). The primary billing/analytics event."""

    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "agent_end"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"

    status: str = "success"
    duration_ms: int = 0

    model: str = ""
    model_provider: str = ""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    total_tokens: int = 0

    tool_calls: int = 0
    tool_errors: int = 0
    tool_names: list[str] = field(default_factory=list)
    estimated_cost_usd: float | None = None

    step_count: int = 0
    llm_calls: int = 0
    skills_loaded_count: int = 0
    skill_names_hash: str = ""
    memory_writes_count: int = 0
    session_search_calls: int = 0
    delegation_depth: int = 0

    cronjob_id: str = ""
    cron_run_id: str = ""
    error: str = ""

    span_id: str = ""
    parent_span_id: str = ""

    secrets_blocked_count: int = 0
    pii_detected_count: int = 0

    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolStartEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "tool_start"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"

    tool_name: str = ""
    tool_call_id: str = ""
    span_id: str = ""
    parent_span_id: str = ""


@dataclass
class ToolEndEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "tool_end"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"

    tool_name: str = ""
    tool_call_id: str = ""
    duration_ms: int = 0
    status: str = "success"
    error: str = ""
    span_id: str = ""
    parent_span_id: str = ""


@dataclass
class LlmInputEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "llm_input"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"

    model: str = ""
    provider: str = ""
    images_count: int = 0
    span_id: str = ""


@dataclass
class LlmOutputEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "llm_output"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"

    model: str = ""
    provider: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    finish_reason: str = ""
    estimated_cost_usd: float | None = None
    span_id: str = ""


@dataclass
class ApiErrorEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "api_error"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"

    model: str = ""
    provider: str = ""
    error_message: str = ""


# ── Stub events for future Hermes hook expansions ─────────────────────────────
# These will be fully wired when Hermes exposes the corresponding Python hooks.

@dataclass
class SubagentSpawnEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "subagent_spawn"
    ts: int = field(default_factory=_now_ms)
    child_session_key: str = ""
    delegation_depth: int = 0


@dataclass
class SkillLoadEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "skill_load"
    ts: int = field(default_factory=_now_ms)
    skill_name: str = ""
    version: str = ""


@dataclass
class MemoryWriteEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "memory_write"
    ts: int = field(default_factory=_now_ms)
    key: str = ""
    value_type: str = ""


@dataclass
class CronStartEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "cron_start"
    ts: int = field(default_factory=_now_ms)
    cronjob_id: str = ""
    cron_run_id: str = ""
    schedule: str = ""


@dataclass
class CronEndEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "cron_end"
    ts: int = field(default_factory=_now_ms)
    cronjob_id: str = ""
    cron_run_id: str = ""
    status: str = "success"
    error: str = ""
    duration_ms: int = 0


@dataclass
class GatewayConnectEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "gateway_connect"
    ts: int = field(default_factory=_now_ms)
    remote_id: str = ""
    protocol: str = ""


@dataclass
class GatewayDisconnectEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "gateway_disconnect"
    ts: int = field(default_factory=_now_ms)
    remote_id: str = ""
    reason: str = ""


@dataclass
class SubagentEndEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "subagent_end"
    ts: int = field(default_factory=_now_ms)
    target_session_key: str = ""
    outcome: str = "success"
    error: str = ""


@dataclass
class SessionSearchEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "session_search"
    ts: int = field(default_factory=_now_ms)
    query: str = ""
    results_count: int = 0


@dataclass
class GatewayReconnectEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "gateway_reconnect"
    ts: int = field(default_factory=_now_ms)
    remote_id: str = ""
    attempt: int = 0


@dataclass
class RetryEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "retry"
    ts: int = field(default_factory=_now_ms)
    reason: str = ""
    attempt: int = 0


@dataclass
class TimeoutEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "timeout"
    ts: int = field(default_factory=_now_ms)
    duration_ms: int = 0


@dataclass
class CancelEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "cancel"
    ts: int = field(default_factory=_now_ms)
    reason: str = ""


@dataclass
class FailureEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "failure"
    ts: int = field(default_factory=_now_ms)
    error: str = ""


@dataclass
class AuditEvent:
    """Security/config audit events — redaction changes, access denials, WAL recovery."""

    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = "hermes"
    platform: str = "hermes"
    event_name: str = "audit"
    ts: int = field(default_factory=_now_ms)
    status: str = "success"
    metadata: dict[str, Any] = field(default_factory=dict)
