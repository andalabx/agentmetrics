from __future__ import annotations

import socket
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


def _now_ms() -> int:
    return int(time.time() * 1000)


def _new_id() -> str:
    return str(uuid.uuid4())


def _hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return ""


@dataclass
class AgentEndEvent:
    """Canonical agent_end event. Call to_payload() to get the wire dict."""

    event_id: str = field(default_factory=_new_id)
    trace_id: str = field(default_factory=_new_id)
    ts: int = field(default_factory=_now_ms)
    event_name: str = "agent_end"
    redaction_policy_version: str = "v1-strict"

    # Caller must supply these
    agent_id: str = ""
    platform: str = ""

    # Auto-detected
    host_id: str | None = field(default_factory=_hostname)

    status: str = "success"
    duration_ms: float = 0.0

    model: str | None = None
    model_provider: str | None = None

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    llm_calls: int = 0
    tool_calls: int = 0
    tool_errors: int = 0
    tool_names: list[str] = field(default_factory=list)

    estimated_cost_usd: float | None = None

    step_count: int = 0
    loop_count: int = 0

    skills_loaded_count: int = 0
    skill_names_hash: str | None = None
    memory_writes_count: int = 0
    session_search_calls: int = 0
    delegation_depth: int = 0

    run_id: str | None = None
    session_id: str | None = None
    span_id: str | None = None
    parent_span_id: str | None = None
    parent_trace_id: str | None = None

    cronjob_id: str | None = None
    cron_run_id: str | None = None

    error: str | None = None

    secrets_blocked_count: int = 0
    pii_detected_count: int = 0

    workflow_id: str | None = None
    skill_name: str | None = None
    toolset: str | None = None
    sdk_version: str | None = None

    metadata: dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> dict[str, Any]:
        """Return a wire-format dict for this event.

        Always-included fields: event_id, trace_id, ts, event_name, agent_id,
        platform, status, redaction_policy_version, tool_calls, tool_errors,
        tool_names, input_tokens, output_tokens, duration_ms.

        Optional fields are included only when non-None / non-empty / non-zero.
        total_tokens is computed when any token count > 0.
        """
        payload: dict[str, Any] = {
            "event_id":                 self.event_id,
            "trace_id":                 self.trace_id,
            "ts":                       self.ts,
            "event_name":               self.event_name,
            "agent_id":                 self.agent_id,
            "platform":                 self.platform,
            "status":                   self.status,
            "redaction_policy_version": self.redaction_policy_version,
            "tool_calls":               self.tool_calls,
            "tool_errors":              self.tool_errors,
            "tool_names":               list(self.tool_names),
            "input_tokens":             self.input_tokens,
            "output_tokens":            self.output_tokens,
            "duration_ms":              self.duration_ms,
        }

        # Compute total_tokens when any token count is positive
        total = (
            self.input_tokens
            + self.output_tokens
            + self.cache_read_tokens
            + self.cache_write_tokens
        )
        if total > 0:
            payload["total_tokens"] = total

        # Optional fields — include only when meaningful
        if self.model:
            payload["model"] = self.model
        if self.model_provider:
            payload["model_provider"] = self.model_provider
        if self.error:
            payload["error"] = self.error
        if self.cache_read_tokens:
            payload["cache_read_tokens"] = self.cache_read_tokens
        if self.cache_write_tokens:
            payload["cache_write_tokens"] = self.cache_write_tokens
        if self.llm_calls:
            payload["llm_calls"] = self.llm_calls
        if self.step_count:
            payload["step_count"] = self.step_count
        if self.loop_count:
            payload["loop_count"] = self.loop_count
        if self.estimated_cost_usd is not None:
            payload["estimated_cost_usd"] = self.estimated_cost_usd
        if self.host_id:
            payload["host_id"] = self.host_id
        if self.workflow_id:
            payload["workflow_id"] = self.workflow_id
        if self.skill_name:
            payload["skill_name"] = self.skill_name
        if self.toolset:
            payload["toolset"] = self.toolset
        if self.secrets_blocked_count:
            payload["secrets_blocked_count"] = self.secrets_blocked_count
        if self.pii_detected_count:
            payload["pii_detected_count"] = self.pii_detected_count
        if self.run_id:
            payload["run_id"] = self.run_id
        if self.session_id:
            payload["session_id"] = self.session_id
        if self.span_id:
            payload["span_id"] = self.span_id
        if self.parent_span_id:
            payload["parent_span_id"] = self.parent_span_id
        if self.parent_trace_id:
            payload["parent_trace_id"] = self.parent_trace_id
        if self.skills_loaded_count:
            payload["skills_loaded_count"] = self.skills_loaded_count
        if self.skill_names_hash:
            payload["skill_names_hash"] = self.skill_names_hash
        if self.memory_writes_count:
            payload["memory_writes_count"] = self.memory_writes_count
        if self.session_search_calls:
            payload["session_search_calls"] = self.session_search_calls
        if self.delegation_depth:
            payload["delegation_depth"] = self.delegation_depth
        if self.cronjob_id:
            payload["cronjob_id"] = self.cronjob_id
        if self.cron_run_id:
            payload["cron_run_id"] = self.cron_run_id
        if self.sdk_version:
            payload["sdk_version"] = self.sdk_version
        if self.metadata:
            payload["metadata"] = self.metadata

        return payload


@dataclass
class SessionStartEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = ""
    platform: str = ""
    event_name: str = "session_start"
    ts: int = field(default_factory=_now_ms)
    redaction_policy_version: str = "v1-strict"


@dataclass
class SessionMetricsEvent:
    """Fired once at session end — aggregates all runs in the session."""

    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = ""
    platform: str = ""
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
    total_estimated_cost_usd: float = 0.0
    compactions: int = 0
    resets: int = 0


@dataclass
class LlmOutputEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = ""
    platform: str = ""
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
    estimated_cost_usd: float = 0.0
    span_id: str = ""


@dataclass
class ToolEndEvent:
    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    agent_id: str = ""
    platform: str = ""
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
class AuditEvent:
    """Security/config audit events — redaction changes, access denials, WAL recovery."""

    event_id: str = field(default_factory=_new_id)
    trace_id: str = ""
    session_id: str = ""
    agent_id: str = ""
    platform: str = ""
    event_name: str = "audit"
    ts: int = field(default_factory=_now_ms)
    status: str = "success"
    metadata: dict[str, Any] = field(default_factory=dict)
