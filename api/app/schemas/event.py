from pydantic import BaseModel, Field
from typing import Optional, Literal, Any


class EventCreate(BaseModel):
    # v2 canonical identity fields
    event_id: Optional[str] = None          # UUID v4, used for idempotency on retry
    trace_id: str
    session_id: Optional[str] = None        # OpenClaw session identifier
    run_id: Optional[str] = None            # OpenClaw run identifier
    agent_id: str
    platform: Optional[str] = None          # "openclaw" | "python" | "javascript"
    event_name: Optional[str] = None        # "agent_end" | "session_metrics" etc.
    ts: Optional[int] = None                # Unix ms timestamp from client
    status: Literal["success", "failed", "timeout", "killed", "cancelled"]
    duration_ms: Optional[float] = None
    cost_usd: float = 0.0
    model: Optional[str] = None
    model_provider: Optional[str] = None
    # Token buckets
    input_tokens: Optional[float] = None
    output_tokens: Optional[float] = None
    cache_read_tokens: Optional[float] = None
    cache_write_tokens: Optional[float] = None
    total_tokens: Optional[float] = None
    # Tools
    tool_calls: Optional[int] = None
    tool_errors: Optional[int] = None
    tool_names: Optional[list[str]] = None  # unique tool names used in run
    # Run shape
    step_count: Optional[int] = None
    llm_calls: Optional[int] = None
    images_count: Optional[int] = None
    # Subagents
    subagents_spawned: Optional[int] = None
    subagent_errors: Optional[int] = None
    # Context health
    compactions: Optional[int] = None
    resets: Optional[int] = None
    # Error
    error: Optional[str] = None
    # Deployment context
    environment: Optional[str] = None
    version: Optional[str] = None
    # Privacy
    redaction_policy_version: Optional[str] = None
    # Subagent / multi-agent tracing
    parent_trace_id: Optional[str] = None
    # Client-side cost estimate (plugin-calculated from local pricing table)
    estimated_cost_usd: Optional[float] = None
    # Catch-all for future fields
    metadata: Optional[dict[str, Any]] = None


class EventResponse(BaseModel):
    status: str
    event_id: str


class BatchEventCreate(BaseModel):
    events: list[EventCreate] = Field(..., min_length=1, max_length=100)


class BatchEventResponse(BaseModel):
    status: str
    accepted: int
    rejected: int
