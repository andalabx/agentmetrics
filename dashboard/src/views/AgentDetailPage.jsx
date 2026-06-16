import React, { useCallback, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getAgent, getAgentNames, renameAgent, getAgentRuns, getAgentHourly, getRecommendations } from "../api/agents";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell } from "recharts";
import RunsTable from "../components/RunsTable";
import RunInspector from "../components/RunInspector";
import Seo from "../components/Seo";
import CostChart from "../components/charts/CostChart";
import AppLayout from "../components/layout/AppLayout";
import usePolling from "../hooks/usePolling";

function timeSince(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function fmtMs(ms) {
  if (ms == null) return "N/A";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function latencyColor(ms) {
  if (ms == null) return "text-t2";
  if (ms < 500)  return "text-savings";
  if (ms < 2000) return "text-accent";
  if (ms < 5000) return "text-cost";
  return "text-danger";
}

function StatCard({ label, value, sub, valueClass = "text-t1", icon }) {
  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-surface px-5 py-5 shadow-card">
      {icon && <div className="mb-3 text-t2">{icon}</div>}
      <p className="text-[10px] uppercase tracking-[0.18em] text-t2">{label}</p>
      <p className={`mt-2.5 text-2xl font-bold tracking-tight ${valueClass}`}>{value}</p>
      {sub && <p className="mt-1.5 text-xs leading-5 text-t2">{sub}</p>}
    </div>
  );
}

function DimBadge({ label, value, color, bg }) {
  return (
    <div className={`flex flex-col rounded-2xl border px-4 py-3 ${bg}`}>
      <p className="text-[10px] uppercase tracking-[0.14em] text-t2">{label}</p>
      <p className={`mt-1 text-base font-bold ${color}`}>{value}</p>
    </div>
  );
}

function LatencyBar({ label, ms, maxMs }) {
  const pct = maxMs > 0 ? Math.min((ms / maxMs) * 100, 100) : 0;
  const fill = ms < 500 ? "bg-savings" : ms < 2000 ? "bg-accent" : ms < 5000 ? "bg-cost" : "bg-danger";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-t2">{label}</span>
        <span className={`font-mono text-sm font-bold ${latencyColor(ms)}`}>{fmtMs(ms)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className={`h-full rounded-full transition-all ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Section({ eyebrow, eyebrowColor = "text-t2", title, description, children }) {
  return (
    <section className="rounded-[28px] border border-[var(--border)] bg-surface shadow-card overflow-hidden">
      <div className="px-6 pt-6 pb-0 sm:px-7 sm:pt-7">
        <p className={`text-xs uppercase tracking-[0.18em] ${eyebrowColor}`}>{eyebrow}</p>
        <h2 className="mt-2 text-xl font-bold tracking-tight text-t1">{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-sm leading-7 text-t2">{description}</p>}
      </div>
      <div className="p-6 sm:p-7">{children}</div>
    </section>
  );
}

function LiveBadge({ lastUpdated }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!lastUpdated) return;
    setSecs(0);
    const interval = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 rounded-full border border-savings/30 bg-savings/10 px-3 py-1 text-xs font-medium text-savings">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-savings" />
        Live
      </span>
      {lastUpdated && (
        <span className="hidden text-xs text-t2 sm:block">
          {secs < 5 ? "Just updated" : `${secs}s ago`}
        </span>
      )}
    </div>
  );
}

function agentDisplayName(agentId, namesMap) {
  if (namesMap[agentId]) return namesMap[agentId];
  if (agentId === "main") return "OpenClaw (main)";
  return agentId;
}

const SLA_DEFAULT_MS = 5000;

function SLAWidget({ p95Ms }) {
  const storageKey = "sla_target_ms";
  const [target, setTarget] = useState(() => {
    try { return parseInt(localStorage.getItem(storageKey) || SLA_DEFAULT_MS, 10); } catch { return SLA_DEFAULT_MS; }
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const met = p95Ms != null ? p95Ms <= target : null;

  const saveTarget = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n > 0) {
      setTarget(n);
      try { localStorage.setItem(storageKey, String(n)); } catch {}
    }
    setEditing(false);
  };

  return (
    <div className={`rounded-2xl border px-5 py-4 ${met === null ? "border-[var(--border)] bg-[var(--surface-2)]" : met ? "border-savings/25 bg-savings/[0.04]" : "border-danger/25 bg-danger/[0.04]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-t2">SLA (p95)</p>
          <p className={`mt-2 text-3xl font-bold tracking-tight ${met === null ? "text-t2" : met ? "text-savings" : "text-danger"}`}>
            {p95Ms != null ? fmtMs(p95Ms) : "N/A"}
          </p>
          <p className="mt-1 text-xs text-t2">
            {met === true && "SLA: Met"}
            {met === false && "SLA: Breached"}
            {met === null && "No data yet"}
          </p>
        </div>
        <div className="text-right">
          {editing ? (
            <div className="flex items-center gap-1.5 mt-1">
              <input
                autoFocus
                type="number"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveTarget(); if (e.key === "Escape") setEditing(false); }}
                className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-t1 focus:border-accent/50 focus:outline-none"
                placeholder="ms"
              />
              <button onClick={saveTarget} className="rounded-lg bg-accent px-2 py-1 text-[10px] font-bold text-accent-txt">Set</button>
              <button onClick={() => setEditing(false)} className="text-[10px] text-t2 hover:text-t1">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => { setDraft(String(target)); setEditing(true); }}
              className="mt-1 flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-t2 transition-colors hover:border-accent/40 hover:text-accent"
            >
              Target: {fmtMs(target)}
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentDetailPage({ agentId: agentIdProp }) {
  const params = useParams();
  const agentId = agentIdProp || params?.agentId;
  const navigate = useNavigate();
  const [agent, setAgent] = useState(null);
  const [namesMap, setNamesMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [selectedRun, setSelectedRun] = useState(null);
  const [extraRuns, setExtraRuns] = useState([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hourlyData, setHourlyData] = useState([]);
  const [agentSavings, setAgentSavings] = useState(null);

  const fetchAgent = useCallback(async () => {
    try {
      const [agentRes, namesRes, hourlyRes, recsRes] = await Promise.all([
        getAgent(agentId),
        getAgentNames(),
        getAgentHourly(agentId).catch(() => ({ data: [] })),
        getRecommendations().catch(() => ({ data: [] })),
      ]);
      setAgent(agentRes.data);
      setNamesMap(namesRes.data);
      setRunsTotal((prev) => prev || agentRes.data?.total_calls || 0);
      setHourlyData(hourlyRes.data || []);
      const agentRecs = (recsRes.data || []).filter(
        (r) => r.agent_id === agentId && r.status !== "dismissed"
      );
      const savings = agentRecs.reduce((s, r) => s + (r.estimated_savings_usd || 0), 0);
      setAgentSavings(agentRecs.length > 0 ? { total: savings, count: agentRecs.length } : null);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(
        err.response?.status === 404
          ? "Agent not found"
          : "Failed to load agent data"
      );
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const handleStartRename = () => {
    setNameInput(namesMap[agentId] || "");
    setRenaming(true);
  };

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

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const currentCount = (agent?.recent_runs?.length ?? 0) + extraRuns.length;
      const res = await getAgentRuns(agentId, { limit: 50, offset: currentCount });
      const data = res?.data ?? {};
      setExtraRuns((prev) => [...prev, ...(data.runs ?? [])]);
      setRunsTotal(data.total ?? 0);
    } catch {}
    finally { setLoadingMore(false); }
  };

  // 5-second live polling on detail page
  usePolling(fetchAgent, 5_000);

  const lat = agent?.latency ?? {};
  const maxLatMs = Math.max(lat.p99 ?? 0, lat.avg ?? 0, 1);
  const hasLatency = lat.p50 != null || lat.p95 != null || lat.p99 != null || lat.avg != null;
  const hasModels = agent?.cost_by_model?.length > 0;

  return (
    <AppLayout>
      <Seo
        title={`${agentId} | AgentMetrics`}
        description={`Full observability for ${agentId}: performance, cost, quality, reliability.`}
        path={`/agents/${encodeURIComponent(agentId)}`}
        app
        robots="noindex,nofollow"
      />

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">

        <section className="rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <button
                onClick={() => navigate("/agents")}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-xs font-medium text-t2 transition-colors hover:text-t1"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                </svg>
                All agents
              </button>
              <p className="mt-5 text-xs uppercase tracking-[0.18em] text-accent">Agent detail</p>
              <div className="mt-2 flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-t1 sm:text-4xl break-all">
                  {agentDisplayName(agentId, namesMap)}
                </h1>
                <button
                  onClick={handleStartRename}
                  className="mt-1 rounded-xl border border-[var(--border)] p-1.5 text-t2 transition-colors hover:border-accent/40 hover:text-accent"
                  title="Rename agent"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </div>
              {namesMap[agentId] && (
                <p className="font-mono text-xs text-t2">{agentId}</p>
              )}
              {renaming && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveRename(); if (e.key === "Escape") setRenaming(false); }}
                    placeholder="Display name..."
                    className="w-56 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-t1 placeholder:text-t2 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                  <button
                    onClick={handleSaveRename}
                    disabled={savingName}
                    className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-txt transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {savingName ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => setRenaming(false)}
                    className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-medium text-t2 transition-colors hover:text-t1"
                  >
                    Cancel
                  </button>
                  {namesMap[agentId] && (
                    <button
                      onClick={async () => {
                        setSavingName(true);
                        try {
                          const { data } = await renameAgent(agentId, "");
                          setNamesMap(data);
                          setRenaming(false);
                        } finally { setSavingName(false); }
                      }}
                      className="text-xs text-t2 underline transition-colors hover:text-danger"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              )}
              <p className="mt-2 text-sm text-t2">
                {agent?.last_seen ? `Last event ${timeSince(agent.last_seen)}` : "Waiting for first event"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <LiveBadge lastUpdated={lastUpdated} />
            </div>
          </div>

          {/* 5-dimension overview strip */}
          {agent && (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <DimBadge
                label="Performance"
                value={lat.p50 != null ? fmtMs(lat.p50) : "N/A"}
                color={latencyColor(lat.p50)}
                bg="border-accent/20 bg-[var(--accent-bg)]"
              />
              <DimBadge
                label="Cost"
                value={`$${agent.avg_cost.toFixed(5)}/run`}
                color="text-cost"
                bg="border-cost/20 bg-cost/[0.04]"
              />
              <DimBadge
                label="Quality"
                value={`${agent.success_rate.toFixed(1)}%`}
                color={agent.success_rate >= 95 ? "text-savings" : agent.success_rate >= 80 ? "text-cost" : "text-danger"}
                bg={agent.success_rate >= 95 ? "border-savings/20 bg-savings/[0.04]" : "border-cost/20 bg-cost/[0.04]"}
              />
              <DimBadge
                label="Reliability"
                value={agent.failed > 0 ? `${agent.failed} failed` : "No failures"}
                color={agent.failed > 0 ? "text-danger" : "text-savings"}
                bg={agent.failed > 0 ? "border-danger/20 bg-danger/[0.04]" : "border-savings/20 bg-savings/[0.04]"}
              />
              <DimBadge
                label="Runs"
                value={agent.total_calls.toLocaleString()}
                color="text-t1"
                bg="border-[var(--border)] bg-[var(--surface-2)]"
              />
            </div>
          )}
        </section>

        {/* Per-agent savings banner */}
        {agentSavings && (
          <div className="rounded-[28px] border border-savings/25 bg-savings/[0.04] px-6 py-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-savings/70">Potential monthly savings</p>
              <p className="mt-1 text-2xl font-bold text-savings">
                ${agentSavings.total < 1 ? agentSavings.total.toFixed(4) : agentSavings.total.toFixed(2)}
                <span className="text-sm font-normal text-t2">/mo</span>
              </p>
              <p className="mt-1 text-xs text-t2">
                {agentSavings.count} open {agentSavings.count === 1 ? "recommendation" : "recommendations"} for this agent
              </p>
            </div>
            <a
              href="/cost?tab=optimize"
              className="shrink-0 rounded-xl border border-savings/30 bg-savings/10 px-4 py-2 text-xs font-semibold text-savings transition-opacity hover:opacity-80"
            >
              View recommendations
            </a>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center text-t2">Loading agent data...</div>
        ) : error ? (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 px-5 py-4 text-danger">{error}</div>
        ) : (
          <>
            <Section
              eyebrow="Performance"
              eyebrowColor="text-accent"
              title="Latency distribution"
              description="p50 is your typical experience. p95/p99 show tail latency that damages reliability under load."
            >
              {hasLatency ? (
                <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
                  {/* Metric cards */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "p50 (median)", ms: lat.p50 },
                      { label: "p95 (fast tail)", ms: lat.p95 },
                      { label: "p99 (slow tail)", ms: lat.p99 },
                      { label: "Average", ms: lat.avg },
                    ].map(({ label, ms }) => (
                      <div key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
                        <p className="text-[10px] text-t2">{label}</p>
                        <p className={`mt-2 font-mono text-xl font-bold tracking-tight ${latencyColor(ms)}`}>
                          {fmtMs(ms)}
                        </p>
                      </div>
                    ))}
                  </div>
                  {/* Bars */}
                  <div className="flex flex-col justify-center gap-4">
                    {[
                      { label: "p50", ms: lat.p50 },
                      { label: "p95", ms: lat.p95 },
                      { label: "p99", ms: lat.p99 },
                      { label: "avg", ms: lat.avg },
                    ].filter(({ ms }) => ms != null).map(({ label, ms }) => (
                      <LatencyBar key={label} label={label} ms={ms} maxMs={maxLatMs} />
                    ))}
                  </div>
                </div>
              ) : (
                <p className="py-4 text-sm text-t2">Latency data will appear after more runs are recorded.</p>
              )}

              {/* MTTR */}
              {agent.mttr_ms != null && (
                <div className="mt-6 border-t border-[var(--border)] pt-6">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-5 py-4 sm:w-1/2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-t2">Mean recovery time</p>
                    <p className={`mt-2 text-2xl font-bold ${agent.mttr_ms < 30000 ? "text-savings" : "text-cost"}`}>
                      {fmtMs(agent.mttr_ms)}
                    </p>
                    <p className="mt-1 text-xs text-t2">Avg time from failure to next successful run.</p>
                  </div>
                </div>
              )}
            </Section>

            <Section
              eyebrow="Cost"
              eyebrowColor="text-cost"
              title="Spend over time"
              description="30-day trace. Watch for drift, spikes, and runs where volume rises without improving outcomes."
            >
              <div className="grid gap-4 sm:grid-cols-3 mb-6">
                <StatCard label="Total spend"  value={`$${agent.total_cost.toFixed(4)}`}  valueClass="text-cost" />
                <StatCard label="Cost per run" value={`$${agent.avg_cost.toFixed(6)}`}    valueClass="text-cost" />
                <StatCard label="Total runs"   value={agent.total_calls.toLocaleString()} valueClass="text-accent" />
              </div>
              <CostChart data={agent.cost_by_day} />

              {/* Hourly run volume – last 24h */}
              {hourlyData.length > 0 && (
                <div className="mt-6 border-t border-[var(--border)] pt-6">
                  <p className="text-xs uppercase tracking-[0.16em] text-t2 mb-4">Run volume, last 24 hours</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                      <RTooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "6px 12px", fontSize: 12 }}>
                              <p style={{ color: "var(--text-3)", marginBottom: 2 }}>{label}</p>
                              <p style={{ color: "#6366f1", fontWeight: 600 }}>{payload[0]?.value} runs</p>
                              {payload[1]?.value > 0 && <p style={{ color: "#EF4444" }}>{payload[1].value} failed</p>}
                            </div>
                          );
                        }}
                        cursor={{ fill: "var(--surface-2)" }}
                      />
                      <Bar dataKey="runs" radius={[4, 4, 0, 0]}>
                        {hourlyData.map((d, i) => (
                          <Cell key={i} fill={d.failed > 0 ? "#F59E0B" : "#6366f1"} fillOpacity={0.7} />
                        ))}
                      </Bar>
                      <Bar dataKey="failed" radius={[4, 4, 0, 0]} fill="#EF4444" fillOpacity={0.6} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="mt-2 text-[10px] text-t3">Green = successful runs. Amber = hour had failures. Red bars = failed count.</p>
                </div>
              )}

              {/* Model breakdown */}
              {hasModels && (
                <div className="mt-6 border-t border-[var(--border)] pt-6">
                  <p className="text-xs uppercase tracking-[0.16em] text-t2 mb-4">Spend by model</p>
                  <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-[var(--border)]">
                        <tr>
                          {["Model", "Cost", "Calls", "Input tokens", "Output tokens", "$/call"].map((h) => (
                            <th key={h} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-t2 ${h !== "Model" ? "text-right" : ""}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {agent.cost_by_model.sort((a, b) => b.cost_usd - a.cost_usd).map((row) => (
                          <tr key={row.model} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                            <td className="px-4 py-3 font-mono text-xs font-semibold text-t1">{row.model}</td>
                            <td className="px-4 py-3 text-right font-mono text-sm font-bold text-cost">${row.cost_usd.toFixed(4)}</td>
                            <td className="px-4 py-3 text-right text-sm text-t2">{row.calls.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-t2">{row.input_tokens.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-t2">{row.output_tokens.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-t2">
                              {row.calls > 0 ? `$${(row.cost_usd / row.calls).toFixed(5)}` : "N/A"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Section>

            {(agent.total_input_tokens > 0 || agent.total_llm_calls > 0 || agent.total_tool_calls > 0) && (
              <Section
                eyebrow="Usage breakdown"
                eyebrowColor="text-accent"
                title="Tokens, tools & activity"
                description="Aggregated across all runs. Cache tokens reduce cost. Higher cache read ratio means better prompt caching."
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Input tokens",       value: (agent.total_input_tokens ?? 0).toLocaleString(),       color: "text-t1" },
                    { label: "Output tokens",      value: (agent.total_output_tokens ?? 0).toLocaleString(),      color: "text-cost" },
                    { label: "Cache read",         value: (agent.total_cache_read_tokens ?? 0).toLocaleString(),  color: "text-savings" },
                    { label: "Cache write",        value: (agent.total_cache_write_tokens ?? 0).toLocaleString(), color: "text-accent" },
                    { label: "LLM calls",          value: (agent.total_llm_calls ?? 0).toLocaleString(),          color: "text-t1" },
                    { label: "Tool calls",         value: (agent.total_tool_calls ?? 0).toLocaleString(),         color: "text-t1" },
                    { label: "Tool errors",        value: (agent.total_tool_errors ?? 0).toLocaleString(),        color: agent.total_tool_errors > 0 ? "text-danger" : "text-savings" },
                    {
                      label: "Tool success rate",
                      value: agent.total_tool_calls > 0
                        ? `${(((agent.total_tool_calls - (agent.total_tool_errors ?? 0)) / agent.total_tool_calls) * 100).toFixed(1)}%`
                        : "N/A",
                      color: agent.total_tool_calls > 0 && (agent.total_tool_errors / agent.total_tool_calls) < 0.05
                        ? "text-savings"
                        : agent.total_tool_calls > 0
                        ? "text-cost"
                        : "text-t2",
                    },
                    { label: "Subagents spawned",  value: (agent.total_subagents_spawned ?? 0).toLocaleString(),  color: "text-t1" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-t2">{label}</p>
                      <p className={`mt-2 font-mono text-xl font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Context health */}
                {(agent.total_compactions > 0 || agent.total_resets > 0) && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className={`rounded-2xl border px-4 py-4 ${agent.total_compactions > 0 ? "border-cost/25 bg-cost/[0.04]" : "border-[var(--border)] bg-[var(--surface-2)]"}`}>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-t2">Context compactions</p>
                      <p className={`mt-2 font-mono text-xl font-bold ${agent.total_compactions > 0 ? "text-cost" : "text-savings"}`}>
                        {agent.total_compactions ?? 0}
                      </p>
                      <p className="mt-1 text-xs text-t2">Times the context window was compacted to save tokens.</p>
                    </div>
                    <div className={`rounded-2xl border px-4 py-4 ${agent.total_resets > 0 ? "border-danger/25 bg-danger/[0.04]" : "border-[var(--border)] bg-[var(--surface-2)]"}`}>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-t2">Session resets</p>
                      <p className={`mt-2 font-mono text-xl font-bold ${agent.total_resets > 0 ? "text-danger" : "text-savings"}`}>
                        {agent.total_resets ?? 0}
                      </p>
                      <p className="mt-1 text-xs text-t2">Sessions wiped mid-run. Investigate for stability issues.</p>
                    </div>
                  </div>
                )}

                {/* Top tools */}
                {agent.top_tools?.length > 0 && (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-t2 mb-3">Most used tools</p>
                    <div className="flex flex-wrap gap-2">
                      {agent.top_tools.map((tool) => (
                        <span key={tool} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 font-mono text-xs text-t2">
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Section>
            )}

            <section className="grid gap-6 xl:grid-cols-2">

              {/* Quality */}
              <div className="rounded-[28px] border border-[var(--border)] bg-surface shadow-card overflow-hidden">
                <div className="px-6 pt-6 sm:px-7 sm:pt-7">
                  <p className="text-xs uppercase tracking-[0.18em] text-savings">Quality</p>
                  <h2 className="mt-2 text-xl font-bold tracking-tight text-t1">Output success</h2>
                  <p className="mt-2 text-sm leading-7 text-t2">Failure patterns and error signatures.</p>
                </div>
                <div className="p-6 sm:p-7">
                  <div className="flex items-end gap-6 mb-6">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-t2">Success rate</p>
                      <p className={`mt-2 text-4xl font-bold tracking-tight ${
                        agent.success_rate >= 95 ? "text-savings" : agent.success_rate >= 80 ? "text-cost" : "text-danger"
                      }`}>
                        {agent.success_rate.toFixed(1)}%
                      </p>
                      <p className="mt-1 text-xs text-t2">{agent.successful} of {agent.total_calls} runs</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-t2">Failed</p>
                      <p className={`mt-2 text-4xl font-bold tracking-tight ${agent.failed > 0 ? "text-danger" : "text-savings"}`}>
                        {agent.failed}
                      </p>
                    </div>
                  </div>

                  {/* Success rate bar */}
                  <div className="h-3 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className={`h-full rounded-full transition-all ${
                        agent.success_rate >= 95 ? "bg-savings" : agent.success_rate >= 80 ? "bg-cost" : "bg-danger"
                      }`}
                      style={{ width: `${agent.success_rate}%` }}
                    />
                  </div>

                  {/* Top errors */}
                  {agent.top_errors?.length > 0 && (
                    <div className="mt-5 space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-danger">Recurring errors</p>
                      {agent.top_errors.map((err, i) => (
                        <div key={i} className="flex items-start justify-between gap-3 rounded-2xl border border-danger/20 bg-danger/[0.04] p-3">
                          <p className="text-xs leading-6 text-danger">{err.error_message}</p>
                          <span className="shrink-0 rounded-full border border-danger/20 bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                            {err.count}×
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Reliability */}
              <div className="rounded-[28px] border border-[var(--border)] bg-surface shadow-card overflow-hidden">
                <div className="px-6 pt-6 sm:px-7 sm:pt-7">
                  <p className="text-xs uppercase tracking-[0.18em] text-cost">Reliability</p>
                  <h2 className="mt-2 text-xl font-bold tracking-tight text-t1">Operational health</h2>
                  <p className="mt-2 text-sm leading-7 text-t2">Failure rate, recovery speed, and abnormal context resets.</p>
                </div>
                <div className="p-6 sm:p-7 grid gap-4">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-5 py-4">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-t2">Failure rate</p>
                    <p className={`mt-2 text-3xl font-bold tracking-tight ${
                      agent.total_calls > 0 && (agent.failed / agent.total_calls) > 0.1 ? "text-danger" : "text-savings"
                    }`}>
                      {agent.total_calls > 0 ? `${((agent.failed / agent.total_calls) * 100).toFixed(1)}%` : "N/A"}
                    </p>
                    <p className="mt-1 text-xs text-t2">{agent.failed} failures in {agent.total_calls} runs</p>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-5 py-4">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-t2">Mean recovery time</p>
                    <p className={`mt-2 text-3xl font-bold tracking-tight ${
                      agent.mttr_ms == null ? "text-t2" : agent.mttr_ms < 30000 ? "text-savings" : "text-cost"
                    }`}>
                      {agent.mttr_ms != null ? fmtMs(agent.mttr_ms) : "N/A"}
                    </p>
                    <p className="mt-1 text-xs text-t2">Avg gap from failure to next successful run</p>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-5 py-4">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-t2">Context resets</p>
                    <p className={`mt-2 text-3xl font-bold tracking-tight ${agent.total_resets > 0 ? "text-danger" : "text-savings"}`}>
                      {agent.total_resets ?? 0}
                    </p>
                    <p className="mt-1 text-xs text-t2">
                      {agent.total_resets > 0 ? "Context was forcefully reset. Possible runaway loops." : "No abnormal resets"}
                    </p>
                  </div>

                  <SLAWidget p95Ms={agent.latency?.p95 ?? null} />
                </div>
              </div>
            </section>

            <Section
              eyebrow="Run history"
              eyebrowColor="text-accent"
              title="Every run"
              description="Click any row to inspect token spend, latency, tool calls, and failure signals. Updates every 5 seconds."
            >
              {(() => {
                const allRuns = [...(agent.recent_runs ?? []), ...extraRuns];
                const total = runsTotal || agent.total_calls || 0;
                const hasMore = allRuns.length < total;
                return (
                  <RunsTable
                    runs={allRuns}
                    onSelectRun={setSelectedRun}
                    hasMore={hasMore}
                    loadingMore={loadingMore}
                    onLoadMore={handleLoadMore}
                    linkState={{ from: agentId, agentName: agentDisplayName(agentId, namesMap) }}
                  />
                );
              })()}
            </Section>
          </>
        )}
      </div>

      <RunInspector run={selectedRun} onClose={() => setSelectedRun(null)} />
    </AppLayout>
  );
}
