from typing import Any, Literal

from pydantic import BaseModel, Field


class EventCreate(BaseModel):
    # v2 canonical identity fields
    event_id: str | None = None          # UUID v4, used for idempotency on retry
    trace_id: str
    session_id: str | None = None        # OpenClaw session identifier
    run_id: str | None = None            # OpenClaw run identifier
    agent_id: str
    platform: str | None = None          # "openclaw" | "python" | "javascript"
    event_name: str | None = None        # "agent_end" | "session_metrics" etc.
    ts: int | None = None                # Unix ms timestamp from client
    status: Literal["success", "failed", "timeout", "killed", "cancelled"]
    duration_ms: float | None = None
    cost_usd: float = 0.0
    model: str | None = None
    model_provider: str | None = None
    # Token buckets
    input_tokens: float | None = None
    output_tokens: float | None = None
    cache_read_tokens: float | None = None
    cache_write_tokens: float | None = None
    total_tokens: float | None = None
    # Tools
    tool_calls: int | None = None
    tool_errors: int | None = None
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
    error: str | None = None
    # Deployment context
    environment: str | None = None
    version: str | None = None
    # Privacy
    redaction_policy_version: str | None = None
    # Subagent / multi-agent tracing
    parent_trace_id: str | None = None
    # Client-side cost estimate (plugin-calculated from local pricing table)
    estimated_cost_usd: float | None = None
    # Catch-all for future fields
    metadata: dict[str, Any] | None = None


class EventResponse(BaseModel):
    status: str
    event_id: str


class BatchEventCreate(BaseModel):
    events: list[EventCreate] = Field(..., min_length=1, max_length=100)


class BatchEventResponse(BaseModel):
    status: str
    accepted: int
    rejected: int
