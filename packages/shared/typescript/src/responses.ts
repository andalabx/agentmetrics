// These match the FastAPI response schemas

export interface RunResponse {
  trace_id: string;
  agent_id: string;
  platform: string;
  status: 'success' | 'failed' | 'running';
  timestamp: string;
  duration_ms: number | null;
  cost_usd: number | null;
  estimated_cost_usd: number | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  tool_calls: number;
  tool_errors: number;
  tool_names: string[];
  llm_calls: number | null;
  step_count: number | null;
  loop_count: number | null;
  error_message: string | null;
  run_id: string | null;
  session_id: string | null;
  parent_trace_id: string | null;
  environment: string | null;
  version: string | null;
  host_id: string | null;
  workflow_id: string | null;
  skill_name: string | null;
  toolset: string | null;
  secrets_blocked_count: number;
  pii_detected_count: number;
  skills_loaded_count: number | null;
  memory_writes_count: number | null;
  delegation_depth: number | null;
  redaction_policy_version: string | null;
  metadata: Record<string, unknown> | null;
  compactions: number | null;
  resets: number | null;
  images_count: number | null;
}

export interface AgentResponse {
  agent_id: string;
  display_name: string | null;
  platform: string | null;
  run_count: number;
  last_seen: string | null;
  total_cost_usd: number;
  avg_duration_ms: number | null;
  error_rate: number;
}

export interface StatsResponse {
  total_runs: number;
  total_cost_usd: number;
  avg_duration_ms: number | null;
  error_rate: number;
  total_input_tokens: number;
  total_output_tokens: number;
}
