export interface AgentEndEvent {
  event_id: string;
  trace_id: string;
  ts: number;
  event_name: 'agent_end';
  agent_id: string;
  platform: string;
  redaction_policy_version: string;
  status: 'success' | 'failed' | 'cancelled';
  duration_ms: number;
  host_id?: string;
  model?: string;
  model_provider?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  llm_calls?: number;
  tool_calls: number;
  tool_errors: number;
  tool_names: string[];
  estimated_cost_usd?: number;
  step_count?: number;
  loop_count?: number;
  error?: string;
  run_id?: string;
  session_id?: string;
  span_id?: string;
  parent_span_id?: string;
  parent_trace_id?: string;
  workflow_id?: string;
  skill_name?: string;
  toolset?: string;
  secrets_blocked_count?: number;
  pii_detected_count?: number;
  skills_loaded_count?: number;
  skill_names_hash?: string;
  memory_writes_count?: number;
  session_search_calls?: number;
  delegation_depth?: number;
  cronjob_id?: string;
  cron_run_id?: string;
  sdk_version?: string;
  metadata?: Record<string, unknown>;
}

export interface LlmOutputEvent {
  event_id: string;
  trace_id: string;
  ts: number;
  event_name: 'llm_output';
  agent_id: string;
  platform: string;
  model: string;
  model_provider?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  finish_reason?: string;
  estimated_cost_usd?: number;
  span_id?: string;
}

export interface ToolEndEvent {
  event_id: string;
  trace_id: string;
  ts: number;
  event_name: 'tool_end';
  agent_id: string;
  platform: string;
  tool_name: string;
  tool_call_id?: string;
  duration_ms: number;
  status: 'success' | 'failed';
  error?: string;
  span_id?: string;
}

export type AnyEvent = AgentEndEvent | LlmOutputEvent | ToolEndEvent;
