from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AgentSummary(BaseModel):
    agent_id: str
    total_calls: int
    successful: int
    failed: int
    total_cost: float
    avg_cost: float
    success_rate: float
    last_seen: Optional[datetime] = None


class RecentRun(BaseModel):
    trace_id: str
    status: str
    cost_usd: float
    duration_ms: Optional[float]
    error_message: Optional[str]
    timestamp: datetime
    model: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    # Per-run detail fields
    step_count: Optional[int] = None
    tool_calls: Optional[int] = None
    loop_count: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    cache_write_tokens: Optional[int] = None
    llm_calls: Optional[int] = None
    environment: Optional[str] = None
    version: Optional[str] = None
    steps: Optional[list] = None


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
    p50: Optional[float] = None
    p95: Optional[float] = None
    p99: Optional[float] = None
    avg: Optional[float] = None


class AgentDetail(BaseModel):
    agent_id: str
    total_calls: int
    successful: int
    failed: int
    total_cost: float
    avg_cost: float
    success_rate: float
    last_seen: Optional[datetime] = None
    # Performance
    latency: LatencyPercentiles = LatencyPercentiles()
    avg_duration_ms: Optional[float] = None
    # Cost breakdown
    cost_by_day: list[CostByDay] = []
    cost_by_model: list[CostByModel] = []
    # Reliability
    mttr_ms: Optional[float] = None
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
    id: Optional[str] = None
    type: str  # "model_switch" | "caching" | "error_fix" | "cost_spike"
    priority: str = "medium"
    title: str
    description: str
    estimated_savings_usd: float
    status: str = "open"
    agent_id: Optional[str] = None
    created_at: Optional[datetime] = None
    calculated_at: Optional[datetime] = None


class AlertRule(BaseModel):
    id: Optional[str] = None
    agent_id: Optional[str] = None
    name: str
    metric: str         # error_rate | cost_usd | duration_ms | loop_count
    operator: str       # gt | lt | gte | lte
    threshold: float
    window_minutes: int = 60
    notify_email: bool = True
    enabled: bool = True


class AlertRuleCreate(BaseModel):
    agent_id: Optional[str] = None
    name: str
    metric: str
    operator: str
    threshold: float
    window_minutes: int = 60
    notify_email: bool = True


class AlertRulePatch(BaseModel):
    name: Optional[str] = None
    threshold: Optional[float] = None
    window_minutes: Optional[int] = None
    notify_email: Optional[bool] = None
    enabled: Optional[bool] = None
