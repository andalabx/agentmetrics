import React, { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { getAgent, getAgentHourly, getAgentRuns, getAgentNames, renameAgent } from "../api/agents";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, Cell,
} from "recharts";
import usePolling from "../hooks/usePolling";

/* ---------- helpers ---------- */

function fmtMs(ms) {
  if (ms == null) return "N/A";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function timeSince(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function agentDisplayName(agentId, namesMap) {
  if (namesMap && namesMap[agentId]) return namesMap[agentId];
  if (agentId === "main") return "OpenClaw (main)";
  return agentId;
}

function healthOf(successRate) {
  if (successRate >= 95) return "healthy";
  if (successRate >= 80) return "degraded";
  return "critical";
}

const statusConfig = {
  healthy:  { color: "text-savings", bg: "border-savings/25 bg-savings/[0.06]", dot: "bg-savings",  label: "Healthy" },
  degraded: { color: "text-cost",    bg: "border-cost/25 bg-cost/[0.06]",       dot: "bg-cost",     label: "Degraded" },
  critical: { color: "text-danger",  bg: "border-danger/25 bg-danger/[0.06]",   dot: "bg-danger",   label: "Critical" },
};

function fmtDur(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/* ---------- mini stat card ---------- */
function MiniStat({ label, value, valueClass = "text-t1" }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-t2">{label}</p>
      <p className={`mt-1.5 text-lg font-bold tracking-tight ${valueClass}`}>{value}</p>
    </div>
  );
}

/* ---------- mini runs table ---------- */
function MiniRunsTable({ runs }) {
  if (!runs?.length) {
    return <p className="py-6 text-center text-xs text-t2">No runs recorded yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left text-[10px] uppercase tracking-[0.14em] text-t2">
            <th className="px-3 py-2.5 font-semibold">Trace</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold text-right">Duration</th>
            <th className="px-3 py-2.5 font-semibold text-right">Cost</th>
            <th className="px-3 py-2.5 font-semibold text-right">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {runs.map((run) => (
            <tr key={run.trace_id} className="hover:bg-[var(--surface-2)] transition-colors">
              <td className="px-3 py-2.5">
                <Link
                  to={`/runs/${run.trace_id}`}
                  className="font-mono text-[10px] text-accent hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {run.trace_id.slice(0, 8)}…
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${
                  run.status === "success"
                    ? "border-savings/25 bg-savings/10 text-savings"
                    : "border-danger/25 bg-danger/10 text-danger"
                }`}>
                  {run.status}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-t2">{fmtDur(run.duration_ms)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-cost">
                {run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : "-"}
              </td>
              <td className="px-3 py-2.5 text-right text-t2">
                {run.started_at ? timeSince(run.started_at) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- main panel ---------- */
export default function AgentDetailPanel({ agentId, onClose }) {
  const [agent, setAgent] = useState(null);
  const [namesMap, setNamesMap] = useState({});
  const [hourlyData, setHourlyData] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // rename state
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  const fetchData = useCallback(async () => {
    if (!agentId) return;
    try {
      const [agentRes, namesRes, hourlyRes, runsRes] = await Promise.all([
        getAgent(agentId),
        getAgentNames(),
        getAgentHourly(agentId).catch(() => ({ data: [] })),
        getAgentRuns(agentId, { limit: 10 }).catch(() => ({ data: { runs: [] } })),
      ]);
      setAgent(agentRes.data);
      setNamesMap(namesRes.data);
      setHourlyData(hourlyRes.data || []);
      setRuns(runsRes.data?.runs ?? []);
      setError(null);
    } catch (err) {
      setError(
        err.response?.status === 404 ? "Agent not found" : "Failed to load agent data"
      );
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  usePolling(fetchData, 10_000);

  const handleSaveRename = async () => {
    setSavingName(true);
    try {
      const { data } = await renameAgent(agentId, nameInput);
      setNamesMap(data);
      setRenaming(false);
    } finally {
      setSavingName(false);
    }
  };

  const startRename = () => {
    setNameInput(namesMap[agentId] || "");
    setRenaming(true);
  };

  if (!agentId) return null;

  const h = agent ? healthOf(agent.success_rate) : null;
  const cfg = h ? statusConfig[h] : null;
  const displayName = agentDisplayName(agentId, namesMap);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Panel header */}
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* health badge */}
            {cfg && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${cfg.bg} ${cfg.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${h === "critical" ? "animate-pulse" : ""}`} />
                {cfg.label}
              </span>
            )}
          </div>

          {!renaming ? (
            <div className="mt-1.5 flex items-center gap-2">
              <h2 className="truncate text-base font-bold text-t1">{displayName}</h2>
              {agent && (
                <button
                  onClick={startRename}
                  className="shrink-0 rounded-lg border border-[var(--border)] p-1 text-t2 transition-colors hover:border-accent/40 hover:text-accent"
                  title="Rename agent"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                placeholder="Display name..."
                className="w-36 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-sm text-t1 placeholder:text-t2 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
              <button
                onClick={handleSaveRename}
                disabled={savingName}
                className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-semibold text-accent-txt transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {savingName ? "..." : "Save"}
              </button>
              <button
                onClick={() => setRenaming(false)}
                className="text-[10px] text-t2 hover:text-t1"
              >
                Cancel
              </button>
            </div>
          )}

          {namesMap[agentId] && !renaming && (
            <p className="mt-0.5 font-mono text-[10px] text-t2">{agentId}</p>
          )}
          {agent?.last_seen && (
            <p className="mt-0.5 text-[11px] text-t2">Last event {timeSince(agent.last_seen)}</p>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="shrink-0 rounded-xl border border-[var(--border)] p-1.5 text-t2 transition-colors hover:border-[var(--border-hover)] hover:text-t1"
          title="Close panel"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-12 text-sm text-t2">
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        ) : agent ? (
          <>
            {/* 5 stat cards */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MiniStat
                label="Success rate"
                value={`${agent.success_rate.toFixed(1)}%`}
                valueClass={agent.success_rate >= 95 ? "text-savings" : agent.success_rate >= 80 ? "text-cost" : "text-danger"}
              />
              <MiniStat
                label="Total cost"
                value={`$${agent.total_cost.toFixed(4)}`}
                valueClass="text-cost"
              />
              <MiniStat
                label="Runs"
                value={agent.total_calls.toLocaleString()}
                valueClass="text-t1"
              />
              <MiniStat
                label="p95 latency"
                value={fmtMs(agent.latency?.p95)}
                valueClass={
                  agent.latency?.p95 == null ? "text-t2"
                  : agent.latency.p95 < 2000 ? "text-savings"
                  : agent.latency.p95 < 5000 ? "text-cost"
                  : "text-danger"
                }
              />
              <MiniStat
                label="Failed"
                value={agent.failed.toLocaleString()}
                valueClass={agent.failed > 0 ? "text-danger" : "text-savings"}
              />
            </div>

            {/* 24h chart */}
            {hourlyData.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <p className="mb-3 text-[10px] uppercase tracking-[0.14em] text-t2">Run volume, last 24 h</p>
                <ResponsiveContainer width="100%" height={110}>
                  <BarChart data={hourlyData} margin={{ top: 2, right: 2, left: 0, bottom: 0 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: "var(--text-3)", fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: "var(--text-3)", fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      width={22}
                    />
                    <RTooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", fontSize: 11 }}>
                            <p style={{ color: "var(--text-3)", marginBottom: 2 }}>{label}</p>
                            <p style={{ color: "#6366f1", fontWeight: 600 }}>{payload[0]?.value} runs</p>
                            {payload[1]?.value > 0 && <p style={{ color: "#EF4444" }}>{payload[1].value} failed</p>}
                          </div>
                        );
                      }}
                      cursor={{ fill: "var(--surface-2)" }}
                    />
                    <Bar dataKey="runs" radius={[3, 3, 0, 0]}>
                      {hourlyData.map((d, i) => (
                        <Cell key={i} fill={d.failed > 0 ? "#F59E0B" : "#6366f1"} fillOpacity={0.7} />
                      ))}
                    </Bar>
                    <Bar dataKey="failed" radius={[3, 3, 0, 0]} fill="#EF4444" fillOpacity={0.6} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Recent runs */}
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-t2">Recent runs</p>
              <MiniRunsTable runs={runs} />
            </div>

          </>
        ) : null}
      </div>
    </div>
  );
}
