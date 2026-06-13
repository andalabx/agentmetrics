from datetime import datetime

from pydantic import BaseModel


class AgentSummary(BaseModel):
    agent_id: str
    total_calls: int
    successful: int
    failed: int
    total_cost: float
    avg_cost: float
    success_rate: float
    last_seen: datetime | None = None


class RecentRun(BaseModel):
    trace_id: str
    status: str
    cost_usd: float
    duration_ms: float | None
    error_message: str | None
    timestamp: datetime
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    # Per-run detail fields
    step_count: int | None = None
    tool_calls: int | None = None
    loop_count: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    llm_calls: int | None = None
    environment: str | None = None
    version: str | None = None
    steps: list | None = None


class CostByDay(BaseModel):
    date: str
    cost: float
    calls: int


class ErrorSummary(BaseModel):
    error_message: str
    count: int


class CostByModel(BaseModel):
    model: str
    cost_usd: float
    calls: int
    input_tokens: int
    output_tokens: int


class LatencyPercentiles(BaseModel):
    p50: float | None = None
    p95: float | None = None
    p99: float | None = None
    avg: float | None = None


class AgentDetail(BaseModel):
    agent_id: str
    total_calls: int
    successful: int
    failed: int
    total_cost: float
    avg_cost: float
    success_rate: float
    last_seen: datetime | None = None
    # Performance
    latency: LatencyPercentiles = LatencyPercentiles()
    avg_duration_ms: float | None = None
    # Cost breakdown
    cost_by_day: list[CostByDay] = []
    cost_by_model: list[CostByModel] = []
    # Reliability
    mttr_ms: float | None = None
    loop_count: int = 0
    # Token detail (from run_metadata JSONB)
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cache_read_tokens: int = 0
    total_cache_write_tokens: int = 0
    total_llm_calls: int = 0
    total_tool_calls: int = 0
    total_tool_errors: int = 0
    total_subagents_spawned: int = 0
    total_compactions: int = 0
    total_resets: int = 0
    top_tools: list[str] = []             # most used tool names across all runs
    # Recent activity
    recent_runs: list[RecentRun] = []
    top_errors: list[ErrorSummary] = []


class Recommendation(BaseModel):
    id: str | None = None
    type: str  # "model_switch" | "caching" | "error_fix" | "cost_spike"
    priority: str = "medium"
    title: str
    description: str
    estimated_savings_usd: float
    status: str = "open"
    agent_id: str | None = None
    created_at: datetime | None = None
    calculated_at: datetime | None = None


class AlertRule(BaseModel):
    id: str | None = None
    agent_id: str | None = None
    name: str
    metric: str         # error_rate | cost_usd | duration_ms | loop_count
    operator: str       # gt | lt | gte | lte
    threshold: float
    window_minutes: int = 60
    notify_email: bool = True
    enabled: bool = True


class AlertRuleCreate(BaseModel):
    agent_id: str | None = None
    name: str
    metric: str
    operator: str
    threshold: float
    window_minutes: int = 60
    notify_email: bool = True


class AlertRulePatch(BaseModel):
    name: str | None = None
    threshold: float | None = None
    window_minutes: int | None = None
    notify_email: bool | None = None
    enabled: bool | None = None
