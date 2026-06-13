import React, { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { getAgents } from "../api/agents";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";
import usePolling from "../hooks/usePolling";

const POLL_MS = 5_000;

function timeSince(dateStr) {
  if (!dateStr) return "—";
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 5)    return "just now";
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtCost(v) {
  if (!v) return "—";
  if (v < 0.0001) return `$${v.toFixed(6)}`;
  if (v < 0.01)   return `$${v.toFixed(4)}`;
  if (v < 1)      return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

function fmtLatency(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusDot({ rate }) {
  if (rate == null) return <span className="h-2 w-2 rounded-full bg-[var(--surface-3)]" />;
  if (rate >= 95)  return <span className="h-2 w-2 rounded-full bg-emerald-500" />;
  if (rate >= 80)  return <span className="h-2 w-2 rounded-full bg-amber-400" />;
  return <span className="h-2 w-2 rounded-full bg-red-500" />;
}

export default function LivePage() {
  const [agents, setAgents] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const fetch = useCallback(async () => {
    try {
      const res = await getAgents();
      const list = res.data?.agents ?? res.data ?? [];
      const sorted = [...list].sort((a, b) => {
        const ta = a.last_run_at ? new Date(a.last_run_at).getTime() : 0;
        const tb = b.last_run_at ? new Date(b.last_run_at).getTime() : 0;
        return tb - ta;
      });
      setAgents(sorted);
      setLastUpdated(new Date());
      setTick((n) => n + 1);
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(fetch, POLL_MS);

  const recentAgents = agents.filter((a) => {
    if (!a.last_run_at) return false;
    return Date.now() - new Date(a.last_run_at).getTime() < 60 * 60 * 1000;
  });

  return (
    <AppLayout>
      <Seo title="Live — AgentMetrics" />
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-t1">Live</h1>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Polling every 5s
            </span>
          </div>
          {lastUpdated && (
            <p className="text-xs text-t3">
              Updated {timeSince(lastUpdated.toISOString())}
            </p>
          )}
        </div>

        {/* Stats bar */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total agents" value={loading ? "—" : agents.length} />
          <StatCard label="Active last hour" value={loading ? "—" : recentAgents.length} accent />
          <StatCard
            label="Avg success rate"
            value={loading || !agents.length ? "—" : `${Math.round(agents.reduce((s, a) => s + (a.success_rate ?? 0), 0) / agents.length)}%`}
          />
          <StatCard
            label="Total runs"
            value={loading ? "—" : agents.reduce((s, a) => s + (a.run_count ?? 0), 0).toLocaleString()}
          />
        </div>

        {/* Agent table */}
        <div className="rounded-2xl border border-[var(--border)] bg-surface overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <p className="text-sm font-medium text-t1">All agents</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-t3">Loading…</div>
          ) : agents.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-xs text-t3">
                    <th className="px-4 py-2.5 text-left font-medium">Agent</th>
                    <th className="px-4 py-2.5 text-left font-medium">Last run</th>
                    <th className="px-4 py-2.5 text-right font-medium">Runs</th>
                    <th className="px-4 py-2.5 text-right font-medium">Success</th>
                    <th className="px-4 py-2.5 text-right font-medium">Avg latency</th>
                    <th className="px-4 py-2.5 text-right font-medium">Avg cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {agents.map((agent) => (
                    <AgentRow key={agent.agent_id} agent={agent} tick={tick} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface px-4 py-3">
      <p className="text-xs text-t3 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${accent ? "text-emerald-400" : "text-t1"}`}>{value}</p>
    </div>
  );
}

function AgentRow({ agent, tick }) {
  const isRecent = agent.last_run_at
    ? Date.now() - new Date(agent.last_run_at).getTime() < 5 * 60 * 1000
    : false;

  return (
    <tr className={`transition-colors hover:bg-[var(--surface-2)] ${isRecent ? "bg-emerald-500/[0.03]" : ""}`}>
      <td className="px-4 py-3">
        <Link
          to={`/agents/${encodeURIComponent(agent.agent_id)}`}
          className="flex items-center gap-2 font-medium text-t1 hover:text-accent"
        >
          <StatusDot rate={agent.success_rate} />
          <span className="truncate max-w-[180px]">{agent.name || agent.agent_id}</span>
        </Link>
      </td>
      <td className="px-4 py-3 text-t2 tabular-nums">
        {/* tick forces re-render so relative times stay fresh */}
        <span key={tick}>{timeSince(agent.last_run_at)}</span>
      </td>
      <td className="px-4 py-3 text-right text-t2 tabular-nums">{(agent.run_count ?? 0).toLocaleString()}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {agent.success_rate != null ? (
          <span className={agent.success_rate >= 95 ? "text-emerald-400" : agent.success_rate >= 80 ? "text-amber-400" : "text-red-400"}>
            {agent.success_rate.toFixed(1)}%
          </span>
        ) : (
          <span className="text-t3">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right text-t2 tabular-nums">{fmtLatency(agent.avg_latency_ms)}</td>
      <td className="px-4 py-3 text-right text-t2 tabular-nums">{fmtCost(agent.avg_cost)}</td>
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-2)]">
        <svg className="h-6 w-6 text-t3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium text-t1">No agents yet</p>
        <p className="mt-0.5 text-xs text-t3">Connect an agent to see live activity here.</p>
      </div>
      <Link to="/connect" className="mt-1 text-xs font-medium text-accent hover:underline">
        View integrations →
      </Link>
    </div>
  );
}
