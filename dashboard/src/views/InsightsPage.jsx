import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell,
  ResponsiveContainer, Tooltip as RTooltip,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";
import { getAgents, getAgentNames, getRecommendations, updateRecommendation } from "../api/agents";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";
import usePolling from "../hooks/usePolling";

// ─── helpers ──────────────────────────────────────────────────────────────────

function agentDisplayName(id, map) {
  if (map && map[id]) return map[id];
  if (id === "main") return "OpenClaw (main)";
  return id;
}

function shortName(name) {
  return name.length > 12 ? name.slice(0, 11) + "…" : name;
}

function fmtCost(v) {
  if (!v || v === 0) return "$0";
  if (v < 0.0001)   return `$${v.toFixed(8)}`;
  if (v < 0.01)     return `$${v.toFixed(6)}`;
  if (v < 1)        return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

const TABS = [
  { id: "performance", label: "Performance" },
  { id: "cost",        label: "Cost" },
  { id: "reliability", label: "Reliability" },
  { id: "optimize",    label: "Optimize" },
];

const PALETTE = ["#6366f1", "#22d3ee", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#3B82F6"];

// ─── shared components ────────────────────────────────────────────────────────

function Stat({ label, value, sub, valueClass = "text-t1", delay = 0 }) {
  return (
    <div className="fade-in-up rounded-[28px] border border-[var(--border)] bg-surface px-5 py-5 shadow-card" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-t2">{label}</p>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${valueClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-t2">{sub}</p>}
    </div>
  );
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 14px", fontSize: 12 }}>
      <p style={{ color: "var(--text-2)", marginBottom: 4 }}>{payload[0]?.payload?.fullName ?? label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.fill ?? p.color ?? "var(--text-1)", fontWeight: 600 }}>
          {formatter ? formatter(p.value, p.name) : `${p.value}`}
        </p>
      ))}
    </div>
  );
}

function RankRow({ rank, name, primary, primaryClass, secondary, secondaryLabel, badge, badgeClass, onClick, delay = 0 }) {
  return (
    <button
      onClick={onClick}
      className="fade-in-up flex w-full items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3.5 text-left transition-all duration-150 hover:border-accent/30 hover:bg-surface hover:-translate-y-px"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="w-5 shrink-0 text-xs font-bold text-t3">#{rank}</span>
      <span className="flex-1 truncate text-sm font-medium text-t1">{name}</span>
      {badge && (
        <span className={`hidden sm:inline shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeClass}`}>
          {badge}
        </span>
      )}
      <div className="text-right shrink-0">
        <p className={`text-sm font-bold tabular-nums ${primaryClass}`}>{primary}</p>
        {secondary && <p className="text-[10px] text-t2">{secondaryLabel}: {secondary}</p>}
      </div>
    </button>
  );
}

// ─── Performance tab ──────────────────────────────────────────────────────────

function PerformanceTab({ agents, namesMap, onAgent }) {
  const sorted = [...agents].sort((a, b) => b.success_rate - a.success_rate);
  const avgRate = agents.length > 0 ? agents.reduce((s, a) => s + a.success_rate, 0) / agents.length : 0;

  const chartData = sorted.map((a, i) => ({
    name:     shortName(agentDisplayName(a.agent_id, namesMap)),
    fullName: agentDisplayName(a.agent_id, namesMap),
    id:       a.agent_id,
    rate:     parseFloat(a.success_rate.toFixed(2)),
    fill:     a.success_rate >= 95 ? "#10B981" : a.success_rate >= 80 ? "#F59E0B" : "#EF4444",
  }));

  const statusBadge = (rate) => {
    if (rate >= 99) return { label: "Excellent", cls: "bg-savings/10 text-savings" };
    if (rate >= 95) return { label: "Good",      cls: "bg-accent/10 text-accent" };
    if (rate >= 80) return { label: "Degraded",  cls: "bg-cost/10 text-cost" };
    return              { label: "Critical",   cls: "bg-danger/10 text-danger" };
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Avg success rate" value={`${avgRate.toFixed(1)}%`} sub={`Across ${agents.length} agents`}
          valueClass={avgRate >= 95 ? "text-savings" : avgRate >= 80 ? "text-cost" : "text-danger"} delay={0} />
        <Stat label="Best performer" value={sorted[0] ? agentDisplayName(sorted[0].agent_id, namesMap) : "N/A"}
          sub={sorted[0] ? `${sorted[0].success_rate.toFixed(1)}% success` : ""} valueClass="text-savings" delay={60} />
        <Stat
          label="Needs attention"
          value={sorted[sorted.length - 1]?.success_rate < 95 ? agentDisplayName(sorted[sorted.length - 1].agent_id, namesMap) : "All healthy"}
          sub={sorted[sorted.length - 1]?.success_rate < 95 ? `${sorted[sorted.length - 1].success_rate.toFixed(1)}% success` : ""}
          valueClass={sorted[sorted.length - 1]?.success_rate < 95 ? "text-danger" : "text-savings"}
          delay={120}
        />
      </div>

      <div className="fade-in-up delay-200 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
        <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-5">Success rate by agent</p>
        <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 42)}>
          <BarChart data={chartData} layout="vertical" barCategoryGap="28%" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" domain={[0, 100]} tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
            <YAxis dataKey="name" type="category" width={90} tick={{ fill: "var(--text-2)", fontSize: 10 }} tickLine={false} axisLine={false} />
            <RTooltip content={<ChartTooltip formatter={(v) => `${v}% success rate`} />} cursor={{ fill: "var(--surface-2)" }} />
            <Bar dataKey="rate" radius={[0, 6, 6, 0]} onClick={(d) => onAgent(d.id)} cursor="pointer">
              {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="fade-in-up delay-300 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
        <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-4">Leaderboard</p>
        <div className="flex flex-col gap-2">
          {sorted.map((a, i) => {
            const b = statusBadge(a.success_rate);
            return (
              <RankRow
                key={a.agent_id}
                rank={i + 1}
                name={agentDisplayName(a.agent_id, namesMap)}
                primary={`${a.success_rate.toFixed(1)}%`}
                primaryClass={a.success_rate >= 95 ? "text-savings" : a.success_rate >= 80 ? "text-cost" : "text-danger"}
                secondary={a.total_calls.toLocaleString()}
                secondaryLabel="runs"
                badge={b.label}
                badgeClass={b.cls}
                onClick={() => onAgent(a.agent_id)}
                delay={i * 30}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Cost tab ─────────────────────────────────────────────────────────────────

function CostTab({ agents, namesMap, onAgent }) {
  const sorted = [...agents].sort((a, b) => b.total_cost - a.total_cost);
  const totalCost = agents.reduce((s, a) => s + a.total_cost, 0);
  const avgCostPerRun = agents.reduce((s, a) => s + a.avg_cost, 0) / Math.max(agents.length, 1);

  const chartData = sorted.slice(0, 10).map((a) => ({
    name:     shortName(agentDisplayName(a.agent_id, namesMap)),
    fullName: agentDisplayName(a.agent_id, namesMap),
    id:       a.agent_id,
    cost:     a.total_cost,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total spend" value={fmtCost(totalCost)} valueClass="text-cost" delay={0} />
        <Stat label="Avg cost per run" value={fmtCost(avgCostPerRun)} valueClass="text-cost" delay={60} />
        <Stat label="Highest spender" value={sorted[0] ? agentDisplayName(sorted[0].agent_id, namesMap) : "N/A"}
          sub={sorted[0] ? `${fmtCost(sorted[0].total_cost)} total` : ""} valueClass="text-cost" delay={120} />
      </div>

      <div className="fade-in-up delay-200 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
        <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-5">Spend by agent</p>
        <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 42)}>
          <BarChart data={chartData} layout="vertical" barCategoryGap="28%" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmtCost} />
            <YAxis dataKey="name" type="category" width={90} tick={{ fill: "var(--text-2)", fontSize: 10 }} tickLine={false} axisLine={false} />
            <RTooltip content={<ChartTooltip formatter={(v) => fmtCost(v)} />} cursor={{ fill: "var(--surface-2)" }} />
            <Bar dataKey="cost" radius={[0, 6, 6, 0]} onClick={(d) => onAgent(d.id)} cursor="pointer">
              {chartData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={1 - i * 0.05} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-4 flex justify-between border-t border-[var(--border)] pt-4 text-xs text-t2">
          <span>Total</span>
          <span className="font-mono font-bold text-cost">{fmtCost(totalCost)}</span>
        </div>
      </div>

      <div className="fade-in-up delay-300 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
        <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-4">Cost per run, ranked</p>
        <div className="flex flex-col gap-2">
          {[...agents].sort((a, b) => b.avg_cost - a.avg_cost).map((a, i) => (
            <RankRow
              key={a.agent_id}
              rank={i + 1}
              name={agentDisplayName(a.agent_id, namesMap)}
              primary={`${fmtCost(a.avg_cost)}/run`}
              primaryClass="text-cost"
              secondary={fmtCost(a.total_cost)}
              secondaryLabel="total"
              onClick={() => onAgent(a.agent_id)}
              delay={i * 30}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Reliability tab ──────────────────────────────────────────────────────────

function ReliabilityTab({ agents, namesMap, onAgent }) {
  const sorted = [...agents].sort((a, b) => b.success_rate - a.success_rate);

  const statusOf = (rate) => {
    if (rate >= 99) return { label: "Excellent", color: "text-savings", bg: "border-savings/25 bg-savings/[0.05]" };
    if (rate >= 95) return { label: "Good",      color: "text-accent",  bg: "border-accent/25 bg-[var(--accent-bg)]" };
    if (rate >= 80) return { label: "Degraded",  color: "text-cost",    bg: "border-cost/25 bg-cost/[0.05]" };
    return              { label: "Critical",   color: "text-danger",  bg: "border-danger/25 bg-danger/[0.05]" };
  };

  const radarData = sorted.slice(0, 6).map((a) => ({
    agent:   shortName(agentDisplayName(a.agent_id, namesMap)),
    Uptime:  parseFloat(a.success_rate.toFixed(1)),
    Volume:  Math.min(100, Math.round((a.total_calls / Math.max(...agents.map((x) => x.total_calls))) * 100)),
    Quality: parseFloat((100 - (a.failed / Math.max(a.total_calls, 1)) * 100).toFixed(1)),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Excellent ≥99%" value={agents.filter((a) => a.success_rate >= 99).length} sub="agents" valueClass="text-savings" delay={0} />
        <Stat label="Good ≥95%" value={agents.filter((a) => a.success_rate >= 95 && a.success_rate < 99).length} sub="agents" valueClass="text-accent" delay={60} />
        <Stat label="Degraded 80–94%" value={agents.filter((a) => a.success_rate >= 80 && a.success_rate < 95).length} sub="agents" valueClass="text-cost" delay={120} />
        <Stat label="Critical <80%" value={agents.filter((a) => a.success_rate < 80).length} sub="agents" valueClass="text-danger" delay={180} />
      </div>

      {radarData.length >= 3 && (
        <div className="fade-in-up delay-200 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
          <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-1">Multi-dimension comparison</p>
          <p className="text-xs text-t2 mb-5">Top agents: uptime, volume, and quality scores</p>
          <div className="flex justify-center">
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} margin={{ top: 8, right: 30, bottom: 8, left: 30 }}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="agent" tick={{ fill: "var(--text-2)", fontSize: 11 }} />
                {["Uptime", "Volume", "Quality"].map((key, i) => (
                  <Radar key={key} name={key} dataKey={key} stroke={PALETTE[i]} fill={PALETTE[i]} fillOpacity={0.12} strokeWidth={2} />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            {["Uptime", "Volume", "Quality"].map((k, i) => (
              <div key={k} className="flex items-center gap-1.5 text-xs text-t2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i] }} />
                {k}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="fade-in-up delay-300 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
        <p className="text-[10px] uppercase tracking-[0.2em] text-t2 mb-5">Agent reliability status</p>
        <div className="flex flex-col gap-3">
          {sorted.map((a, i) => {
            const s = statusOf(a.success_rate);
            return (
              <button
                key={a.agent_id}
                onClick={() => onAgent(a.agent_id)}
                className={`fade-in-up flex items-center justify-between gap-4 rounded-2xl border px-5 py-3.5 text-left transition-all duration-150 hover:opacity-80 hover:-translate-y-px ${s.bg}`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <span className="text-sm font-medium text-t1 truncate">{agentDisplayName(a.agent_id, namesMap)}</span>
                <div className="flex items-center gap-4 shrink-0">
                  <span className={`font-mono text-sm font-bold tabular-nums ${s.color}`}>{a.success_rate.toFixed(1)}%</span>
                  <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${s.color}`}>{s.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Optimize tab (Recommendations) ──────────────────────────────────────────

const TYPE_ICON = {
  error_fix:       { bg: "bg-danger/10", color: "text-danger",  path: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" },
  model_switch:    { bg: "bg-accent/10",  color: "text-accent",  path: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
  caching:         { bg: "bg-cost/10",    color: "text-cost",    path: "M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" },
  instrumentation: { bg: "bg-savings/10", color: "text-savings", path: "M9.348 14.651a3.75 3.75 0 010-5.303m5.304-.001a3.75 3.75 0 010 5.304m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.809 3.808 9.98 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" },
  reliability:     { bg: "bg-accent/10",  color: "text-accent",  path: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" },
};

const priorityStyle = {
  high:   "border-danger/30 bg-danger/10 text-danger",
  medium: "border-cost/30 bg-cost/10 text-cost",
  low:    "border-t3/30 bg-[var(--surface-2)] text-t2",
};

const statusStyle = {
  open:        "border-accent/30 bg-[var(--accent-bg)] text-accent",
  in_progress: "border-cost/30 bg-cost/10 text-cost",
  resolved:    "border-savings/30 bg-savings/10 text-savings",
  dismissed:   "border-t3/30 bg-[var(--surface-2)] text-t2",
};

function RecCard({ rec, onStatusChange, delay = 0 }) {
  const [loading, setLoading] = useState(false);
  const icon = TYPE_ICON[rec.type] ?? TYPE_ICON.reliability;

  const transition = async (newStatus) => {
    setLoading(true);
    try { await onStatusChange(rec.id, newStatus); }
    finally { setLoading(false); }
  };

  const actions = {
    open:        [{ label: "Start",   next: "in_progress" }, { label: "Dismiss", next: "dismissed" }],
    in_progress: [{ label: "Resolve", next: "resolved"    }, { label: "Dismiss", next: "dismissed" }],
    resolved:    [{ label: "Reopen",  next: "open"        }],
    dismissed:   [{ label: "Reopen",  next: "open"        }],
  };

  return (
    <div
      className="fade-in-up rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card transition-all duration-200 hover:border-accent/20 sm:p-6"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-1 gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${icon.bg}`}>
            <svg className={`h-5 w-5 ${icon.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={icon.path} />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${priorityStyle[rec.priority] || priorityStyle.low}`}>
                {rec.priority}
              </span>
              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${statusStyle[rec.status] || statusStyle.open}`}>
                {rec.status.replace("_", " ")}
              </span>
            </div>
            <h3 className="mt-2 text-base font-semibold text-t1">{rec.title}</h3>
            {rec.description && <p className="mt-1.5 text-sm leading-7 text-t2">{rec.description}</p>}
            {rec.created_at && (
              <p className="mt-2 text-xs text-t2">
                {new Date(rec.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            )}
          </div>
        </div>

        {rec.estimated_savings_usd > 0 && (
          <div className="shrink-0 rounded-2xl border border-savings/20 bg-savings/[0.06] px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-[0.16em] text-savings/70">Est. savings</p>
            <p className="mt-1 text-xl font-bold text-savings">
              ${rec.estimated_savings_usd < 1 ? rec.estimated_savings_usd.toFixed(4) : rec.estimated_savings_usd.toFixed(2)}
              <span className="text-sm font-normal text-t2">/mo</span>
            </p>
          </div>
        )}
      </div>

      {(actions[rec.status] || []).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
          {(actions[rec.status] || []).map(({ label, next }) => (
            <button
              key={next}
              onClick={() => transition(next)}
              disabled={loading}
              className={`rounded-xl border px-4 py-2 text-xs font-semibold transition-all hover:opacity-80 disabled:opacity-50 ${
                next === "resolved"
                  ? "border-savings/30 bg-savings/10 text-savings"
                  : next === "in_progress"
                  ? "border-accent/30 bg-[var(--accent-bg)] text-accent"
                  : "border-[var(--border)] bg-[var(--surface-2)] text-t2"
              }`}
            >
              {loading ? "…" : label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const REC_TABS = ["open", "in_progress", "resolved", "dismissed", "all"];

function OptimizeTab() {
  const [recs, setRecs]       = useState([]);
  const [tab, setTab]         = useState("open");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchRecs = useCallback(async () => {
    try {
      const { data } = await getRecommendations();
      setRecs(data);
      setError(null);
    } catch (err) {
      if (![404, 401].includes(err?.response?.status)) {
        setRecs((prev) => { if (prev.length > 0) setError("Failed to refresh recommendations"); return prev; });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(fetchRecs, 30_000);

  const handleStatusChange = async (id, newStatus) => {
    await updateRecommendation(id, newStatus);
    setRecs((prev) => prev.map((r) => r.id === id ? { ...r, status: newStatus } : r));
  };

  const filtered = tab === "all" ? recs : recs.filter((r) => r.status === tab);
  const totalSavings = recs.filter((r) => r.status !== "dismissed").reduce((s, r) => s + (r.estimated_savings_usd || 0), 0);

  if (loading) return (
    <div className="flex min-h-[30vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-accent" />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {totalSavings > 0 && (
        <div className="fade-in-up rounded-[28px] border border-savings/25 bg-savings/[0.04] px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-savings/70">Potential monthly savings</p>
            <p className="mt-1 text-3xl font-bold text-savings">${totalSavings.toFixed(0)}<span className="text-base font-normal text-t2">/mo</span></p>
          </div>
          <svg className="h-10 w-10 text-savings/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
          </svg>
        </div>
      )}

      {error && <div className="rounded-2xl border border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {REC_TABS.map((t) => {
          const count = t === "all" ? recs.length : recs.filter((r) => r.status === t).length;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${
                tab === t
                  ? "border-accent/30 bg-[var(--accent-bg)] text-accent"
                  : "border-[var(--border)] bg-surface text-t2 hover:text-t1"
              }`}
            >
              {t.replace("_", " ")} {count > 0 && <span className="ml-1 opacity-60">({count})</span>}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[28px] border border-[var(--border)] bg-surface p-10 text-center shadow-card">
          {tab === "open" ? (
            <>
              <p className="text-t2">No open recommendations. Your agents look well-optimized, or more run data is needed.</p>
              <a href="/agents" className="mt-3 inline-block text-sm font-medium text-accent underline decoration-accent/40 hover:decoration-accent">
                View agent activity
              </a>
            </>
          ) : (
            <p className="text-t2">No {tab.replace("_", " ")} recommendations.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((rec, i) => (
            <RecCard key={rec.id} rec={rec} onStatusChange={handleStatusChange} delay={i * 50} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const navigate = useNavigate();
  const [agents, setAgents]   = useState([]);
  const [namesMap, setNames]  = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const validTabs = TABS.map((t) => t.id);
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("tab");
      if (p && validTabs.includes(p)) return p;
    }
    return "performance";
  });

  const fetchData = useCallback(async () => {
    try {
      const [aRes, nRes] = await Promise.allSettled([getAgents(), getAgentNames()]);
      if (aRes.status === "fulfilled") { setAgents(aRes.value.data); setError(null); }
      else if (![404, 401].includes(aRes.reason?.response?.status)) {
        setAgents((prev) => { if (prev.length > 0) setError("Failed to refresh data."); return prev; });
      }
      if (nRes.status === "fulfilled") setNames(nRes.value.data ?? {});
    } catch (e) {
      if (![404, 401].includes(e.response?.status)) {
        setAgents((prev) => { if (prev.length > 0) setError("Failed to refresh data."); return prev; });
      }
    } finally { setLoading(false); }
  }, []);

  usePolling(fetchData, 15_000);

  const onAgent = (id) => navigate(`/agents/${encodeURIComponent(id)}`);

  const switchTab = (id) => {
    setTab(id);
    const url = id === "performance" ? "/insights" : `/insights?tab=${id}`;
    window.history.replaceState(null, "", url);
  };

  return (
    <AppLayout>
      <Seo title="Cost — AgentMetrics" description="Cost, performance, reliability, and optimization across your agents." path="/cost" app robots="noindex,nofollow" />

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">

        <section className="fade-in-up rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card sm:p-7">
          <h1 className="text-3xl font-bold tracking-tight text-t1 sm:text-4xl">Cost</h1>
          <p className="mt-2 text-sm leading-7 text-t2">
            Cost, performance, reliability, and optimization across every agent.
          </p>
        </section>

        {error && <div className="rounded-2xl border border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger">{error}</div>}

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all duration-150 ${
                tab === t.id
                  ? "border-accent/30 bg-[var(--accent-bg)] text-accent scale-[1.02]"
                  : "border-[var(--border)] bg-surface text-t2 hover:text-t1 hover:border-[var(--border-strong)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== "optimize" && loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-accent" />
              <p className="text-sm text-t2">Loading insights…</p>
            </div>
          </div>
        ) : tab !== "optimize" && agents.length === 0 ? (
          <div className="rounded-[28px] border border-[var(--border)] bg-surface p-10 text-center shadow-card">
            <p className="text-t2">No agents tracked yet. Instrument your first agent to see insights here.</p>
          </div>
        ) : (
          <>
            {tab === "performance" && <PerformanceTab agents={agents} namesMap={namesMap} onAgent={onAgent} />}
            {tab === "cost"        && <CostTab        agents={agents} namesMap={namesMap} onAgent={onAgent} />}
            {tab === "reliability" && <ReliabilityTab agents={agents} namesMap={namesMap} onAgent={onAgent} />}
            {tab === "optimize"    && <OptimizeTab />}
          </>
        )}
      </div>
    </AppLayout>
  );
}
