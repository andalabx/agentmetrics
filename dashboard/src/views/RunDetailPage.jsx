import { useEffect, useState } from "react";
import { useNavigate, useLocation, useParams, Link } from "react-router-dom";
import { getRun } from "../api/runs";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";

function fmtCost(v) {
  if (!v || v === 0) return "$0";
  if (v < 0.0001) return `$${v.toFixed(8)}`;
  if (v < 0.01)   return `$${v.toFixed(6)}`;
  if (v < 1)      return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function fmtTimestamp(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }) {
  const map = {
    success: "border-savings/30 bg-savings/10 text-savings",
    failed:  "border-danger/30  bg-danger/10  text-danger",
    running: "border-cost/30   bg-cost/10    text-cost",
  };
  const cls = map[status] || "border-[var(--border)] bg-[var(--surface-2)] text-t2";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {status === "running" && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {status}
    </span>
  );
}

function MetaRow({ label, value, mono }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--border)] last:border-0">
      <span className="text-xs text-t2 shrink-0">{label}</span>
      <span className={`text-xs font-medium text-t1 text-right break-all ${mono ? "font-mono" : ""}`}>{String(value)}</span>
    </div>
  );
}

function ExecutionSummary({ run }) {
  const stats = [
    { label: "Steps",          value: run.step_count,        color: "text-t1" },
    { label: "LLM calls",      value: run.llm_calls,         color: "text-accent" },
    { label: "Tool calls",     value: run.tool_calls,        color: "text-savings" },
    { label: "Tool errors",    value: run.tool_errors,       color: run.tool_errors > 0 ? "text-danger" : "text-t1" },
    { label: "Loops",          value: run.loop_count,        color: "text-t1" },
    { label: "Subagents",      value: run.subagents_spawned, color: "text-t1" },
    { label: "Subagent errors",value: run.subagent_errors,   color: run.subagent_errors > 0 ? "text-danger" : "text-t1" },
  ].filter((s) => s.value != null && s.value > 0);

  if (stats.length === 0) return null;

  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
      <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-4">Execution summary</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {stats.map(({ label, value, color }) => (
          <div key={label} className="flex flex-col gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
            <span className={`text-xl font-bold tabular-nums leading-none ${color}`}>{value}</span>
            <span className="text-[10px] text-t2">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenBar({ label, value, total, color }) {
  if (!value || !total) return null;
  const pct = Math.min((value / total) * 100, 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[10px] text-t2">{label}</span>
      <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-16 text-right font-mono text-xs text-t2 tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

export default function RunDetailPage({ traceId: traceIdProp }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params   = useParams();
  const traceId  = traceIdProp || params?.traceId;
  const [run, setRun]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    getRun(traceId)
      .then((res) => setRun(res.data))
      .catch((err) => {
        if (err.response?.status === 404) setError("Run not found.");
        else setError("Failed to load run. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [traceId]);

  const totalTokens = run
    ? (run.input_tokens || 0) + (run.output_tokens || 0) + (run.cache_read_tokens || 0) + (run.cache_write_tokens || 0)
    : 0;

  return (
    <AppLayout>
      <Seo
        title={run ? `Run ${traceId.slice(0, 8)} | AgentMetrics` : "Run Detail | AgentMetrics"}
        description="Detailed view of a single agent run."
        path={`/runs/${traceId}`}
        app
        robots="noindex,nofollow"
      />

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">

        {/* Back breadcrumb */}
        <div className="mb-5">
          <button
            onClick={() => {
              const fromAgent = location.state?.from;
              if (fromAgent) navigate(`/agents/${encodeURIComponent(fromAgent)}`);
              else if (run?.agent_id) navigate(`/agents/${encodeURIComponent(run.agent_id)}`);
              else navigate(-1);
            }}
            className="flex items-center gap-1.5 text-xs text-t2 transition-colors hover:text-t1"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {location.state?.agentName
              ? `Back to ${location.state.agentName}`
              : run?.agent_id
              ? `Back to ${run.agent_id}`
              : "Back"}
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse rounded-[28px] border border-[var(--border)] bg-surface p-6 h-32" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-[28px] border border-danger/20 bg-danger/[0.04] p-8 text-center">
            <p className="text-sm font-semibold text-danger">{error}</p>
            <button onClick={() => navigate(-1)} className="mt-4 text-xs text-t2 transition-colors hover:text-t1">← Go back</button>
          </div>
        ) : run ? (
          <div className="flex flex-col gap-5">

            {/* Header */}
            <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={run.status} />
                    {run.environment && (
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-0.5 text-[10px] font-medium text-t2">
                        {run.environment}
                      </span>
                    )}
                    {run.version && (
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-0.5 text-[10px] font-medium text-t2">
                        v{run.version}
                      </span>
                    )}
                  </div>
                  <h1 className="mt-2 font-mono text-sm font-semibold text-t1 break-all">{run.trace_id}</h1>
                  <p className="mt-1 text-xs text-t2">{fmtTimestamp(run.timestamp)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-end">
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums text-cost">{fmtCost(run.cost_usd)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-t2">cost</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums text-t1">{fmtDuration(run.duration_ms)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-t2">duration</p>
                  </div>
                </div>
              </div>

              {run.error_message && (
                <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/[0.05] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-danger mb-1">Error</p>
                  <p className="font-mono text-xs text-danger/90 break-all">{run.error_message}</p>
                </div>
              )}
            </div>

            {/* Execution summary */}
            <ExecutionSummary run={run} />

            {/* Cost reconciliation */}
            {run.estimated_cost_usd != null && (
              <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
                <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-1">Cost reconciliation</p>
                <h3 className="text-sm font-bold text-t1 mb-4">Estimated vs actual</h3>
                <div className="flex flex-col gap-0">
                  <div className="flex items-center justify-between py-2.5 border-b border-[var(--border)]">
                    <span className="text-xs text-t2">Server calculated</span>
                    <span className="font-mono text-xs font-semibold text-cost">{fmtCost(run.cost_usd)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 border-b border-[var(--border)]">
                    <span className="text-xs text-t2">Client estimated</span>
                    <span className="font-mono text-xs font-semibold text-t1">{fmtCost(run.estimated_cost_usd)}</span>
                  </div>
                  {run.cost_usd > 0 && run.estimated_cost_usd > 0 && (() => {
                    const variance = ((run.estimated_cost_usd - run.cost_usd) / run.cost_usd) * 100;
                    const absVar = Math.abs(variance);
                    const color = absVar > 15 ? "text-danger" : absVar > 5 ? "text-cost" : "text-savings";
                    return (
                      <div className="flex items-center justify-between py-2.5">
                        <span className="text-xs text-t2">Variance</span>
                        <span className={`font-mono text-xs font-semibold ${color}`}>
                          {variance >= 0 ? "+" : ""}{variance.toFixed(1)}%
                          {absVar > 15 && <span className="ml-1.5 text-[10px]">⚠ pricing table may be outdated</span>}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Token usage */}
            {(run.input_tokens || run.output_tokens) ? (
              <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
                <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-1">Token usage</p>
                <h3 className="text-sm font-bold text-t1 mb-4">{(totalTokens).toLocaleString()} total tokens</h3>
                <div className="flex flex-col gap-2.5">
                  <TokenBar label="Input tokens"       value={run.input_tokens}        total={totalTokens} color="var(--accent)" />
                  <TokenBar label="Output tokens"      value={run.output_tokens}       total={totalTokens} color="#10B981" />
                  <TokenBar label="Cache read"         value={run.cache_read_tokens}   total={totalTokens} color="#F59E0B" />
                  <TokenBar label="Cache write"        value={run.cache_write_tokens}  total={totalTokens} color="#8B5CF6" />
                </div>
                {run.model && (
                  <p className="mt-3 text-xs text-t2">Model: <span className="font-mono text-t1">{run.model}</span></p>
                )}
              </div>
            ) : null}

            {/* Metadata */}
            <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
              <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-1">Run metadata</p>
              <h3 className="text-sm font-bold text-t1 mb-4">Details</h3>
              <div>
                <MetaRow label="Agent"              value={run.agent_id}                mono />
                <MetaRow label="Trace ID"           value={run.trace_id}                mono />
                <MetaRow label="Session ID"         value={run.session_id}              mono />
                <MetaRow label="Run ID"             value={run.run_id}                  mono />
                {run.parent_trace_id && (
                  <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--border)]">
                    <span className="text-xs text-t2 shrink-0">Parent trace</span>
                    <Link
                      to={`/runs/${run.parent_trace_id}`}
                      className="font-mono text-xs font-medium text-accent text-right break-all transition-opacity hover:opacity-75"
                    >
                      {run.parent_trace_id}
                    </Link>
                  </div>
                )}
                <MetaRow label="Platform"           value={run.platform} />
                <MetaRow label="Model"              value={run.model}                   mono />
                <MetaRow label="Compactions"        value={run.compactions} />
                <MetaRow label="Resets"             value={run.resets} />
                <MetaRow label="Images"             value={run.images_count} />
                <MetaRow label="Environment"        value={run.environment} />
                <MetaRow label="Version"            value={run.version} />
                <MetaRow label="Redaction policy"   value={run.redaction_policy_version} mono />
              </div>

              {run.tool_names && run.tool_names.length > 0 && (
                <div className="py-2.5 border-b border-[var(--border)]">
                  <span className="text-xs text-t2">Tools used</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {run.tool_names.map((name) => (
                      <span key={name} className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[10px] text-t2">{name}</span>
                    ))}
                  </div>
                </div>
              )}

              {run.metadata && Object.keys(run.metadata).length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-[11px] text-t2 transition-colors hover:text-t1">
                    Raw metadata ({Object.keys(run.metadata).length} keys)
                  </summary>
                  <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[10px] text-t2 leading-relaxed">
                    {JSON.stringify(run.metadata, null, 2)}
                  </pre>
                </details>
              )}
            </div>

          </div>
        ) : null}
      </div>
    </AppLayout>
  );
}
