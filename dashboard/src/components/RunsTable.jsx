import React from "react";
import { Link } from "react-router-dom";

function StatusPill({ status }) {
  const tone = status === "success"
    ? "border-savings/25 bg-savings/10 text-savings"
    : "border-danger/25 bg-danger/10 text-danger";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${tone}`}>
      {status}
    </span>
  );
}

function fmtDur(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTok(n) {
  if (n == null) return "-";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function timeSince(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function RunsTable({ runs, onSelectRun, loadingMore, onLoadMore, hasMore, linkState }) {
  if (!runs?.length) {
    return <p className="py-8 text-center text-sm text-t2">No runs recorded yet.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left text-[10px] uppercase tracking-[0.16em] text-t2">
              <th className="px-4 py-3 font-semibold">Trace</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Model</th>
              <th className="px-4 py-3 font-semibold text-right">Duration</th>
              <th className="px-4 py-3 font-semibold text-right">Cost</th>
              <th className="hidden lg:table-cell px-4 py-3 font-semibold text-right">Tokens in</th>
              <th className="hidden lg:table-cell px-4 py-3 font-semibold text-right">Tokens out</th>
              <th className="hidden md:table-cell px-4 py-3 font-semibold text-right">Steps</th>
              <th className="px-4 py-3 font-semibold text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {runs.map((run) => (
              <tr
                key={run.trace_id}
                onClick={() => onSelectRun?.(run)}
                className={`transition-colors hover:bg-[var(--surface-2)] ${onSelectRun ? "cursor-pointer" : ""}`}
              >
                <td className="px-4 py-3 font-mono text-xs text-t2">
                  <Link
                    to={`/runs/${encodeURIComponent(run.trace_id)}`}
                    state={linkState}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-lg bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] text-t1 transition-colors hover:bg-[var(--accent-bg)] hover:text-accent"
                  >
                    {run.trace_id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={run.status} />
                </td>
                <td className="px-4 py-3 text-xs text-t2">
                  {run.model ? (
                    <span className="font-mono">{run.model.replace("claude-", "").replace("-20", "-'")}</span>
                  ) : (
                    <span className="text-t2">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-t2">
                  {fmtDur(run.duration_ms)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-cost">
                  ${(run.cost_usd || 0).toFixed(5)}
                </td>
                <td className="hidden lg:table-cell px-4 py-3 text-right font-mono text-xs text-t2">
                  {fmtTok(run.input_tokens)}
                </td>
                <td className="hidden lg:table-cell px-4 py-3 text-right font-mono text-xs text-t2">
                  {fmtTok(run.output_tokens)}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-right text-xs text-t2">
                  {run.step_count != null ? run.step_count : "-"}
                </td>
                <td className="px-4 py-3 text-right text-xs text-t2 whitespace-nowrap">
                  {timeSince(run.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(hasMore || loadingMore) && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-xl border border-[var(--border)] px-5 py-2.5 text-sm font-medium text-t2 transition-colors hover:bg-[var(--surface-2)] hover:text-t1 disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load more runs"}
          </button>
        </div>
      )}
    </div>
  );
}
