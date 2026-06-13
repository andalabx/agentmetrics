import React, { useEffect, useState } from "react";
import { getSlo } from "../api/slo";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";

const WINDOWS = [
  { label: "1h",  value: 1 },
  { label: "6h",  value: 6 },
  { label: "24h", value: 24 },
  { label: "7d",  value: 168 },
  { label: "30d", value: 720 },
];

function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000)   return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtAge(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60)    return `${seconds}s ago`;
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function fmtPct(v) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtCost(v) {
  if (v == null || v === 0) return "$0";
  if (v < 0.0001) return `$${v.toFixed(8)}`;
  if (v < 0.01)   return `$${v.toFixed(6)}`;
  if (v < 1)      return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function healthColor(rate) {
  if (rate == null) return "text-t2";
  if (rate >= 0.99) return "text-savings";
  if (rate >= 0.95) return "text-cost";
  return "text-danger";
}

function freshnessBadge(seconds) {
  if (seconds == null) return "text-t2";
  if (seconds < 300)   return "text-savings";
  if (seconds < 1800)  return "text-cost";
  return "text-danger";
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
      <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-1">{label}</p>
      <p className={`text-3xl font-bold tabular-nums leading-none ${color ?? "text-t1"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-t2">{sub}</p>}
    </div>
  );
}

function LatencyBar({ label, value }) {
  if (value == null) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
      <span className="text-xs text-t2">{label}</span>
      <span className="font-mono text-xs font-semibold text-t1">{fmtDuration(value)}</span>
    </div>
  );
}

function TrendChart({ trend }) {
  if (!trend || trend.length === 0) return null;
  const maxTotal = Math.max(...trend.map((r) => r.total), 1);
  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
      <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-4">Hourly success rate (last 24h)</p>
      <div className="flex items-end gap-1 h-20">
        {trend.map((row, i) => {
          const heightPct = Math.max((row.total / maxTotal) * 100, 4);
          const sr = row.success_rate ?? 0;
          const barColor = sr >= 0.99 ? "bg-savings" : sr >= 0.95 ? "bg-cost" : "bg-danger";
          return (
            <div
              key={i}
              title={`${new Date(row.hour).toLocaleTimeString()} — ${row.total} runs, ${fmtPct(row.success_rate)} success`}
              className="flex-1 flex flex-col justify-end"
            >
              <div
                className={`w-full rounded-sm ${barColor} opacity-80`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        {trend.length > 0 && (
          <>
            <span className="text-[10px] text-t3">{new Date(trend[0].hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="text-[10px] text-t3">{new Date(trend[trend.length - 1].hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function SloPage() {
  const [windowHours, setWindowHours] = useState(24);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getSlo(windowHours)
      .then((res) => setData(res.data))
      .catch(() => setError("Failed to load SLO data. Please try again."))
      .finally(() => setLoading(false));
  }, [windowHours]);

  return (
    <AppLayout>
      <Seo
        title="Health & SLO | AgentMetrics"
        description="Ingest pipeline health and run quality metrics."
        path="/health"
        app
        robots="noindex,nofollow"
      />

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">

        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold text-t1">Health & SLO</h1>
            <p className="text-xs text-t2 mt-0.5">Ingest pipeline health and run quality metrics</p>
          </div>
          <div className="flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWindowHours(w.value)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                  windowHours === w.value
                    ? "bg-surface text-t1 shadow-sm"
                    : "text-t2 hover:text-t1"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse rounded-[28px] border border-[var(--border)] bg-surface p-6 h-28" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-[28px] border border-danger/20 bg-danger/[0.04] p-8 text-center">
            <p className="text-sm font-semibold text-danger">{error}</p>
          </div>
        ) : data ? (
          <div className="flex flex-col gap-5">

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Success rate"
                value={fmtPct(data.runs.success_rate)}
                sub={`${data.runs.total} runs`}
                color={healthColor(data.runs.success_rate)}
              />
              <StatCard
                label="Error rate"
                value={fmtPct(data.runs.error_rate)}
                sub={`${data.runs.failed} failed`}
                color={data.runs.error_rate > 0.05 ? "text-danger" : "text-t1"}
              />
              <StatCard
                label="Data freshness"
                value={fmtAge(data.freshness.age_seconds)}
                sub={`${data.freshness.agents_active} active agents`}
                color={freshnessBadge(data.freshness.age_seconds)}
              />
              <StatCard
                label="Total cost"
                value={fmtCost(data.cost.total_usd)}
                sub={`avg ${fmtCost(data.cost.avg_per_run_usd)} / run`}
                color="text-cost"
              />
            </div>

            {/* Hourly trend chart */}
            <TrendChart trend={data.trend} />

            {/* Latency + Coverage side by side */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Latency */}
              <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
                <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-1">Latency</p>
                <h3 className="text-sm font-bold text-t1 mb-4">Run duration percentiles</h3>
                <div>
                  <LatencyBar label="p50" value={data.latency.p50_ms} />
                  <LatencyBar label="p95" value={data.latency.p95_ms} />
                  <LatencyBar label="p99" value={data.latency.p99_ms} />
                  <LatencyBar label="Avg" value={data.latency.avg_ms} />
                </div>
              </div>

              {/* Agent coverage */}
              <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
                <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-1">Agent coverage</p>
                <h3 className="text-sm font-bold text-t1 mb-4">Active vs total</h3>
                <div className="flex items-end gap-3">
                  <div className="text-center">
                    <p className="text-3xl font-bold tabular-nums text-accent">{data.freshness.agents_active}</p>
                    <p className="text-[10px] text-t2 mt-0.5">active ({WINDOWS.find((w) => w.value === windowHours)?.label})</p>
                  </div>
                  <div className="text-t2 text-lg font-light">/</div>
                  <div className="text-center">
                    <p className="text-3xl font-bold tabular-nums text-t1">{data.freshness.agents_total}</p>
                    <p className="text-[10px] text-t2 mt-0.5">all time</p>
                  </div>
                </div>
                {data.freshness.latest_event_at && (
                  <p className="mt-4 text-xs text-t2">
                    Last event: <span className="text-t1">{new Date(data.freshness.latest_event_at).toLocaleString()}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Top errors */}
            {data.top_errors && data.top_errors.length > 0 && (
              <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
                <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-1">Top errors</p>
                <h3 className="text-sm font-bold text-t1 mb-4">Most frequent error messages</h3>
                <div className="flex flex-col gap-2">
                  {data.top_errors.map((e, i) => (
                    <div key={i} className="flex items-start justify-between gap-4 rounded-2xl border border-danger/10 bg-danger/[0.03] px-3 py-2.5">
                      <span className="font-mono text-xs text-danger/90 break-all flex-1">{e.message}</span>
                      <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">{e.count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Window note */}
            <p className="text-center text-[10px] text-t3">
              Data from the last {WINDOWS.find((w) => w.value === windowHours)?.label} · generated at{" "}
              {new Date(data.generated_at).toLocaleString()}
            </p>

          </div>
        ) : null}
      </div>
    </AppLayout>
  );
}
