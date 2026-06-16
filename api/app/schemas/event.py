import json
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

_SECRET_PATTERNS = [
    re.compile(r'sk-[A-Za-z0-9]{20,}'),
    re.compile(r'Bearer [A-Za-z0-9._\-]{20,}'),
    re.compile(r'(?i)password\s*[:=]\s*\S+'),
]


class EventCreate(BaseModel):
    # v2 canonical identity fields
    event_id: str | None = None          # UUID v4, used for idempotency on retry
    trace_id: str = Field(..., max_length=255)
    session_id: str | None = None        # OpenClaw session identifier
    run_id: str | None = None            # OpenClaw run identifier
    agent_id: str = Field(..., max_length=255)
    platform: str | None = None          # "openclaw" | "python" | "javascript"
    event_name: str | None = None        # "agent_end" | "session_metrics" etc.
    ts: int | None = None                # Unix ms timestamp from client
    status: Literal["success", "failed", "timeout", "killed", "cancelled"]
    duration_ms: float | None = Field(None, ge=0)
    cost_usd: float = Field(0.0, ge=0)
    model: str | None = Field(None, max_length=200)
    model_provider: str | None = None
    # Token buckets
    input_tokens: float | None = None
    output_tokens: float | None = None
    cache_read_tokens: float | None = None
    cache_write_tokens: float | None = None
    total_tokens: float | None = None
    # Tools
    tool_calls: int | None = Field(None, ge=0, le=1_000_000)
    tool_errors: int | None = Field(None, ge=0, le=1_000_000)
    tool_names: list[str] | None = None  # unique tool names used in run
    # Run shape
    step_count: int | None = None
    llm_calls: int | None = None
    images_count: int | None = None
    # Subagents
    subagents_spawned: int | None = None
    subagent_errors: int | None = None
    # Context health
    compactions: int | None = None
    resets: int | None = None
    # Error
    error: str | None = Field(None, max_length=2000)
    # Deployment context
    environment: str | None = Field(None, max_length=100)
    version: str | None = Field(None, max_length=100)
    # Privacy
    redaction_policy_version: str | None = None
    # Subagent / multi-agent tracing
    parent_trace_id: str | None = None
    # Client-side cost estimate (plugin-calculated from local pricing table)
    estimated_cost_usd: float | None = None
    # SDK version that emitted this event
    sdk_version: str | None = Field(None, max_length=32)
    # Catch-all for future fields
    metadata: dict[str, Any] | None = None

    @field_validator("metadata")
    @classmethod
    def cap_metadata_size(cls, v):
        if v is not None and len(json.dumps(v)) > 65_536:
            raise ValueError("metadata must be 64KB or smaller")
        return v

    @field_validator("error")
    @classmethod
    def scrub_error_secrets(cls, v):
        if v is None:
            return v
        for pattern in _SECRET_PATTERNS:
            v = pattern.sub("[REDACTED]", v)
        return v


class EventResponse(BaseModel):
    status: str
    event_id: str


class BatchEventCreate(BaseModel):
    events: list[EventCreate] = Field(..., min_length=1, max_length=100)


class BatchEventResponse(BaseModel):
    status: str
    accepted: int
    rejected: int
