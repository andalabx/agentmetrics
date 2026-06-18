import { useEffect } from "react";

function Row({ label, value, valueClass = "text-t1", mono = false }) {
  if (value == null || value === "-") return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--border)] last:border-0">
      <span className="text-xs text-t2 shrink-0">{label}</span>
      <span className={`text-xs font-medium text-right ${valueClass} ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-t2">{title}</p>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4">
        {children}
      </div>
    </div>
  );
}

function fmtDur(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(3)} s`;
}

function fmtTok(n) {
  if (n == null) return null;
  return n.toLocaleString();
}

function statusColor(status) {
  return status === "success" ? "text-savings" : "text-danger";
}

export default function RunInspector({ run, onClose }) {
  useEffect(() => {
    if (!run) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [run, onClose]);

  if (!run) return null;

  const hasTokenDetail = run.input_tokens != null || run.output_tokens != null
    || run.cache_read_tokens != null || run.cache_write_tokens != null;
  const hasActivity = run.llm_calls != null || run.tool_calls != null
    || run.step_count != null || run.loop_count != null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-md flex-col border-l border-[var(--border)] bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-t2">Run inspector</p>
            <p className="mt-1 font-mono text-sm font-semibold text-t1 break-all">{run.trace_id}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-t2 transition-colors hover:bg-[var(--surface-2)] hover:text-t1"
            aria-label="Close inspector"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">

          {/* Status + timestamp */}
          <div className="mb-5 flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
            <span className={`text-sm font-bold uppercase tracking-wide ${statusColor(run.status)}`}>
              {run.status}
            </span>
            <span className="text-xs text-t2">
              {new Date(run.timestamp).toLocaleString()}
            </span>
          </div>

          {/* Performance */}
          <Section title="Performance">
            <Row label="Duration" value={fmtDur(run.duration_ms)} mono />
            <Row label="Model" value={run.model} mono />
            <Row label="Environment" value={run.environment} />
            <Row label="Version" value={run.version} mono />
          </Section>

          {/* Cost */}
          <Section title="Cost">
            <Row label="Total cost" value={`$${(run.cost_usd || 0).toFixed(6)}`} mono valueClass="text-cost" />
          </Section>

          {/* Tokens */}
          {hasTokenDetail && (
            <Section title="Token usage">
              <Row label="Input tokens" value={fmtTok(run.input_tokens)} mono />
              <Row label="Output tokens" value={fmtTok(run.output_tokens)} mono valueClass="text-cost" />
              <Row label="Cache read" value={fmtTok(run.cache_read_tokens)} mono valueClass="text-savings" />
              <Row label="Cache write" value={fmtTok(run.cache_write_tokens)} mono valueClass="text-accent" />
            </Section>
          )}

          {/* Activity */}
          {hasActivity && (
            <Section title="Activity">
              <Row label="LLM calls" value={run.llm_calls?.toLocaleString()} mono />
              <Row label="Tool calls" value={run.tool_calls?.toLocaleString()} mono />
              <Row label="Steps" value={run.step_count?.toLocaleString()} mono />
              <Row label="Loop iterations" value={run.loop_count?.toLocaleString()} mono
                valueClass={run.loop_count > 10 ? "text-cost" : "text-t1"} />
            </Section>
          )}

          {/* Step traces */}
          {run.steps?.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-t2">Step traces</p>
              <div className="space-y-2">
                {run.steps.map((step, i) => (
                  <div key={i} className={`rounded-2xl border px-4 py-3 ${step.status === "error" ? "border-danger/20 bg-danger/[0.04]" : "border-[var(--border)] bg-[var(--surface-2)]"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${step.status === "error" ? "bg-danger" : "bg-savings"}`} />
                        <span className="text-xs font-semibold text-t1">{step.name || `Step ${i + 1}`}</span>
                      </div>
                      <span className="font-mono text-xs text-t2">{step.duration_ms != null ? fmtDur(step.duration_ms) : ""}</span>
                    </div>
                    {(step.tokens_in != null || step.tokens_out != null) && (
                      <div className="mt-1.5 flex gap-4 pl-3.5">
                        {step.tokens_in   != null && <span className="text-[11px] text-t2">{step.tokens_in.toLocaleString()} in</span>}
                        {step.tokens_out  != null && <span className="text-[11px] text-cost">{step.tokens_out.toLocaleString()} out</span>}
                      </div>
                    )}
                    {step.error && (
                      <p className="mt-1.5 pl-3.5 text-[11px] leading-5 text-danger">{step.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {run.status === "failed" && run.error_message && (
            <div className="rounded-2xl border border-danger/25 bg-danger/[0.05] px-4 py-4">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-danger">Failure signal</p>
              <p className="text-xs leading-6 text-danger">{run.error_message}</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
