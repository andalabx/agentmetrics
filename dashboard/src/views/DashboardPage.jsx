import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { getAgents, getRecommendations, getAgentNames, getMonthlyStats, getWeekComparison } from "../api/agents";
import { getFleetHealth, getFleetBriefing } from "../api/fleet";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";
import usePolling from "../hooks/usePolling";
import OnboardingOverlay from "../components/OnboardingOverlay";

// ─── helpers ──────────────────────────────────────────────────────────────────

function healthOf(a) {
  if (a.success_rate >= 95) return "healthy";
  if (a.success_rate >= 80) return "degraded";
  return "critical";
}

function timeSince(dateStr) {
  if (!dateStr) return null;
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function displayName(id, map) {
  if (map[id]) return map[id];
  if (id === "main") return "OpenClaw (main)";
  return id;
}

function fmtCost(v) {
  if (!v || v === 0) return "$0";
  if (v < 0.0001) return `$${v.toFixed(8)}`;
  if (v < 0.01)   return `$${v.toFixed(6)}`;
  if (v < 1)      return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

const HEALTH = {
  healthy:  { dot: "#10B981", label: "Healthy",  ring: "border-emerald-500/20",  glow: "hover:border-emerald-500/40",  text: "text-savings", bg: "bg-savings/[0.06]" },
  degraded: { dot: "#F59E0B", label: "Degraded", ring: "border-amber-500/20",    glow: "hover:border-amber-500/40",    text: "text-cost",    bg: "bg-cost/[0.06]" },
  critical: { dot: "#EF4444", label: "Critical", ring: "border-red-500/20",      glow: "hover:border-red-500/40",      text: "text-danger",  bg: "bg-danger/[0.06]" },
};

function scoreColor(s) {
  if (s >= 85) return "#10B981";
  if (s >= 65) return "#F59E0B";
  return "#EF4444";
}

function scoreLabel(s) {
  if (s >= 90) return "Excellent";
  if (s >= 75) return "Good";
  if (s >= 55) return "Fair";
  return "At Risk";
}

// ─── skeletons ────────────────────────────────────────────────────────────────

function KPISkeleton() {
  return (
    <div className="animate-pulse rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between mb-4">
        <div className="h-2.5 w-20 rounded bg-[var(--surface-2)]" />
        <div className="h-9 w-9 rounded-xl bg-[var(--surface-2)]" />
      </div>
      <div className="h-9 w-28 rounded bg-[var(--surface-2)]" />
      <div className="mt-2 h-2.5 w-24 rounded bg-[var(--surface-2)]" />
    </div>
  );
}

// ─── Fleet Health Score gauge ──────────────────────────────────────────────────

function FleetScoreGauge({ health, loading }) {
  const score     = health?.score ?? 100;
  const breakdown = health?.breakdown ?? {};
  const color     = scoreColor(score);

  const r = 52;
  const cx = 68, cy = 68;
  const circumference = Math.PI * r;
  const pct = Math.min(score / 100, 1);
  const filled = pct * circumference;
  const gap    = circumference - filled;

  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-t2">Agent Health</p>
          <h2 className="mt-0.5 text-base font-bold tracking-tight text-t1">Overall score</h2>
        </div>
        <a href="/cost" className="flex items-center gap-1 text-xs font-medium text-accent transition-opacity hover:opacity-75">
          Details
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
        </a>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-28 animate-pulse">
          <div className="h-24 w-24 rounded-full bg-[var(--surface-2)]" />
        </div>
      ) : (
        <div className="flex items-center gap-5">
          {/* SVG arc gauge */}
          <div className="relative shrink-0">
            <svg width="136" height="80" viewBox="0 0 136 90">
              {/* Track */}
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none"
                stroke="var(--surface-2)"
                strokeWidth="10"
                strokeLinecap="round"
              />
              {/* Fill */}
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none"
                stroke={color}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${filled} ${gap}`}
                style={{ transition: "stroke-dasharray 0.7s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
              <span className="text-3xl font-bold tabular-nums leading-none" style={{ color }}>
                {Math.round(score)}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-t2 mt-0.5">{scoreLabel(score)}</span>
            </div>
          </div>

          {/* Breakdown bars */}
          <div className="flex flex-1 flex-col gap-2">
            {[
              { key: "success",  label: "Uptime",    max: 40 },
              { key: "cost",     label: "Cost",      max: 30 },
              { key: "alerts",   label: "Alerts",    max: 20 },
              { key: "latency",  label: "Latency",   max: 10 },
            ].map(({ key, label, max }) => {
              const val = breakdown[key] ?? max;
              const pct = max > 0 ? (val / max) * 100 : 0;
              const c   = pct >= 80 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10px] text-t2">{label}</span>
                  <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: c }} />
                  </div>
                  <span className="w-8 text-right font-mono text-[10px] text-t2 tabular-nums">{val.toFixed(0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Morning Briefing ─────────────────────────────────────────────────────────

function MorningBriefing({ briefing, loading }) {
  if (loading) {
    return (
      <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-3 w-3 rounded-full bg-[var(--surface-2)]" />
          <div className="h-2.5 w-20 rounded bg-[var(--surface-2)]" />
        </div>
        <div className="h-4 w-3/4 rounded bg-[var(--surface-2)] mb-2" />
        <div className="h-3 w-full rounded bg-[var(--surface-2)] mb-1" />
        <div className="h-3 w-2/3 rounded bg-[var(--surface-2)]" />
      </div>
    );
  }

  if (!briefing?.headline) return null;

  return (
    <div className="rounded-[28px] border border-accent/15 bg-[var(--accent-bg)]/40 p-5 shadow-card">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent mt-0.5">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-t1 leading-snug">{briefing.headline}</p>
          {briefing.body && (
            <p className="mt-1.5 text-xs leading-relaxed text-t2">{briefing.body}</p>
          )}
          {briefing.cta && (
            <a href="/cost?tab=optimize" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent transition-opacity hover:opacity-75">
              {briefing.cta}
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Issue Strip ──────────────────────────────────────────────────────────────

function IssueStrip({ agents, namesMap, onAgent }) {
  if (agents.length === 0) return null;

  return (
    <div className="rounded-2xl border border-danger/20 bg-danger/[0.03] p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-danger">
          {agents.length} agent{agents.length !== 1 ? "s" : ""} need attention
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {agents.map((a) => {
          const cfg = HEALTH[healthOf(a)];
          return (
            <button
              key={a.agent_id}
              onClick={() => onAgent(a.agent_id)}
              className={`flex shrink-0 flex-col gap-1.5 rounded-2xl border ${cfg.ring} ${cfg.bg} px-3 py-2.5 text-left min-w-[130px] transition-opacity hover:opacity-80`}
            >
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cfg.dot }} />
                <p className="truncate text-[11px] font-semibold text-t1 max-w-[100px]">
                  {displayName(a.agent_id, namesMap)}
                </p>
              </div>
              <p className={`text-lg font-bold tabular-nums leading-none ${cfg.text}`}>
                {a.success_rate.toFixed(1)}%
              </p>
              <p className="text-[10px] text-t2">{a.failed} failed</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, icon, valueClass, iconBg, delay = 0, trend }) {
  return (
    <div
      className="fade-in-up group rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg cursor-default"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-t2">{label}</p>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110 ${iconBg}`}>
          {icon}
        </div>
      </div>
      <p className={`mt-3 text-[2rem] font-bold tracking-tight leading-none ${valueClass}`}>{value}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-t2">{sub}</p>
        {trend && (
          <span className={`text-[11px] font-bold tabular-nums ${trend.up ? "text-savings" : "text-danger"}`}>
            {trend.up ? "▲" : "▼"} {trend.pct}%
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Fleet health donut ───────────────────────────────────────────────────────

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 14px", fontSize: 12 }}>
      <span style={{ color: d.payload.fill, fontWeight: 700 }}>{d.name}</span>
      <span style={{ color: "var(--text-2)", marginLeft: 8 }}>{d.value} agent{d.value !== 1 ? "s" : ""}</span>
    </div>
  );
}

function FleetHealthRing({ agents }) {
  const counts = {
    healthy:  agents.filter((a) => healthOf(a) === "healthy").length,
    degraded: agents.filter((a) => healthOf(a) === "degraded").length,
    critical: agents.filter((a) => healthOf(a) === "critical").length,
  };
  const avg = agents.length > 0
    ? agents.reduce((s, a) => s + a.success_rate, 0) / agents.length
    : 0;

  const data = [
    { name: "Healthy",  value: counts.healthy,  fill: "#10B981" },
    { name: "Degraded", value: counts.degraded, fill: "#F59E0B" },
    { name: "Critical", value: counts.critical, fill: "#EF4444" },
  ].filter((d) => d.value > 0);

  if (data.length === 0) data.push({ name: "No data", value: 1, fill: "var(--border-strong)" });

  const uptimeColor = avg >= 95 ? "#10B981" : avg >= 80 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius="64%" outerRadius="88%" paddingAngle={data.length > 1 ? 3 : 0} dataKey="value" strokeWidth={0} startAngle={90} endAngle={-270}>
              {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
            </Pie>
            <RTooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color: uptimeColor }}>{avg.toFixed(1)}%</span>
          <span className="text-[10px] uppercase tracking-[0.15em] text-t2">uptime</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 w-full">
        {[
          { key: "healthy",  color: "#10B981", label: "Healthy",  count: counts.healthy },
          { key: "degraded", color: "#F59E0B", label: "Degraded", count: counts.degraded },
          { key: "critical", color: "#EF4444", label: "Critical", count: counts.critical },
        ].map(({ color, label, count }) => {
          const pct = agents.length > 0 ? (count / agents.length) * 100 : 0;
          return (
            <div key={label} className="flex items-center gap-3">
              <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="w-20 shrink-0 text-xs text-t2">{label}</span>
              <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="w-8 text-right font-mono text-xs font-bold text-t1 tabular-nums">{count}</span>
            </div>
          );
        })}
        <p className="text-[11px] text-t2 mt-1">{agents.length} agent{agents.length !== 1 ? "s" : ""} monitored</p>
      </div>
    </div>
  );
}

// ─── Cost bar chart ───────────────────────────────────────────────────────────

function CostBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 14px", fontSize: 12 }}>
      <p style={{ color: "var(--text-2)", marginBottom: 2, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{payload[0].payload.name}</p>
      <p style={{ color: "#F59E0B", fontWeight: 700 }}>{fmtCost(payload[0].value)}</p>
      <p style={{ color: "var(--text-3)" }}>{payload[0].payload.runs} runs</p>
    </div>
  );
}

function CostBars({ agents, namesMap, onAgent }) {
  const data = [...agents]
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 8)
    .map((a) => ({ name: displayName(a.agent_id, namesMap), id: a.agent_id, cost: a.total_cost, runs: a.total_calls }));

  if (data.every((d) => d.cost === 0)) {
    return <div className="flex h-36 items-center justify-center text-sm text-t2">No cost data yet. Cost is computed from token usage.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCost(v)} />
        <YAxis dataKey="name" type="category" width={80} tick={{ fill: "var(--text-2)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => v.length > 10 ? v.slice(0, 10) + "…" : v} />
        <RTooltip content={<CostBarTooltip />} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="cost" radius={[0, 6, 6, 0]} fill="#F59E0B" fillOpacity={0.85} onClick={(d) => onAgent(d.id)} cursor="pointer">
          {data.map((_, i) => <Cell key={i} fill={i === 0 ? "#F59E0B" : i === 1 ? "#FBBF24" : "#FCD34D"} fillOpacity={1 - i * 0.06} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Agent card grid ──────────────────────────────────────────────────────────

function AgentCard({ agent, name, delay, onClick }) {
  const h = healthOf(agent);
  const cfg = HEALTH[h];
  const since = timeSince(agent.last_seen);

  return (
    <button
      onClick={onClick}
      className={`fade-in-up group relative flex flex-col gap-3.5 rounded-[24px] border ${cfg.ring} ${cfg.glow} bg-surface p-4 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: cfg.dot }} />
        <span className="truncate font-mono text-xs font-medium text-t1" title={name}>{name}</span>
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className={`text-3xl font-bold tabular-nums tracking-tight ${cfg.text}`}>{agent.success_rate.toFixed(1)}</span>
          <span className={`text-sm font-semibold ${cfg.text}`}>%</span>
        </div>
        <p className="text-[10px] uppercase tracking-[0.15em] text-t2 mt-0.5">success rate</p>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${agent.success_rate}%`, background: cfg.dot }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-t2">
        <span className="tabular-nums">{agent.total_calls.toLocaleString()} runs</span>
        <div className="flex items-center gap-2">
          {agent.failed > 0 && <span className="text-danger tabular-nums">{agent.failed} failed</span>}
          {since && <span className="text-t3">{since} ago</span>}
        </div>
      </div>
    </button>
  );
}

// ─── Recommendation card ──────────────────────────────────────────────────────

const REC_ICONS = {
  error_fix:       "🔧",
  model_switch:    "⚡",
  caching:         "💾",
  instrumentation: "📡",
  reliability:     "🛡️",
};

function RecCard({ rec }) {
  if (!rec) return null;
  return (
    <div className="rounded-[24px] border border-savings/20 bg-savings/[0.04] p-4">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5">{REC_ICONS[rec.type] ?? "💡"}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-t1 leading-snug">{rec.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-t2 line-clamp-3">{rec.description}</p>
          {rec.estimated_savings_usd > 0 && (
            <p className="mt-2 text-sm font-bold text-savings">
              {fmtCost(rec.estimated_savings_usd)}<span className="font-normal text-t2 text-xs">/mo potential</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  const [platform, setPlatform] = useState("python");
  const [snippetCopied, setSnippetCopied] = useState(false);

  const platforms = [
    {
      id: "python", label: "Python",
      icon: (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
          <path d="M11.914 0C5.82 0 6.2 2.656 6.2 2.656l.007 2.752h5.814v.826H3.887S0 5.789 0 11.969c0 6.18 3.403 5.96 3.403 5.96h2.034v-2.867s-.109-3.402 3.35-3.402h5.766s3.24.052 3.24-3.13V3.13S18.28 0 11.914 0zM8.708 1.81a1.05 1.05 0 11-.001 2.1 1.05 1.05 0 010-2.1z"/>
          <path d="M12.086 24c6.094 0 5.714-2.656 5.714-2.656l-.007-2.752h-5.814v-.826h8.134S24 18.211 24 12.031c0-6.18-3.403-5.96-3.403-5.96h-2.034v2.867s.109 3.402-3.35 3.402H9.447s-3.24-.052-3.24 3.13v5.37S5.72 24 12.086 24zm3.206-1.81a1.05 1.05 0 110-2.1 1.05 1.05 0 010 2.1z"/>
        </svg>
      ),
      snippet: `pip install agentmetrics\n\nimport agentmetrics\nagentmetrics.configure(base_url="http://localhost:8099")\n\n@agentmetrics.track(agent_id="my-agent")\ndef my_agent(task):\n    return result`,
    },
    {
      id: "javascript", label: "JavaScript",
      icon: (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
          <path d="M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z"/>
        </svg>
      ),
      snippet: `npm install agentmetrics\n\nimport agentmetrics from "agentmetrics";\nagentmetrics.configure({ baseUrl: "http://localhost:8099" });\n\nconst myAgent = agentmetrics.track("my-agent",\n  async (task) => await callLLM(task)\n);`,
    },
    {
      id: "openclaw", label: "OpenClaw",
      icon: <img src="/logos/openclaw.svg" className="h-3.5 w-3.5 shrink-0" alt="" />,
      snippet: `openclaw plugins install agentmetrics-openclaw\n\nexport AGENTMETRICS_BASE_URL=http://localhost:8099\n\n# Run your agent as normal — no code changes needed.`,
    },
    {
      id: "langchain", label: "LangChain",
      icon: <img src="/logos/langchain-color.svg" className="h-3.5 w-3.5 shrink-0" alt="" />,
      snippet: `pip install agentmetrics langchain\n\nimport agentmetrics\nagentmetrics.configure(base_url="http://localhost:8099")\n\n@agentmetrics.track(agent_id="my-langchain-agent")\ndef run_agent(task: str) -> str:\n    return agent_executor.invoke({"input": task})["output"]`,
    },
    {
      id: "crewai", label: "CrewAI",
      icon: <img src="/logos/crewai.svg" className="h-3.5 w-3.5 shrink-0" alt="" />,
      snippet: `pip install agentmetrics crewai\n\nimport agentmetrics\nagentmetrics.configure(base_url="http://localhost:8099")\n\n@agentmetrics.track(agent_id="my-crew")\ndef run_crew(task_input: str) -> str:\n    return crew.kickoff()`,
    },
    {
      id: "llamaindex", label: "LlamaIndex",
      icon: <img src="/logos/llamaindex.svg" className="h-3.5 w-3.5 shrink-0" alt="" />,
      snippet: `pip install agentmetrics llama-index\n\nimport agentmetrics\nagentmetrics.configure(base_url="http://localhost:8099")\n\n@agentmetrics.track(agent_id="my-llama-agent")\ndef run_query(question: str) -> str:\n    return str(query_engine.query(question))`,
    },
  ];

  const fullSnippet = platforms.find((p) => p.id === platform)?.snippet ?? "";

  const copySnippet = () => {
    navigator.clipboard.writeText(fullSnippet);
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 2000);
  };

  return (
    <div className="flex min-h-[55vh] items-center justify-center px-2">
      <div className="w-full max-w-lg">
        <div className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-[18px] border border-accent/20 bg-[var(--accent-bg)]">
          <svg className="h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight text-t1">Your first agent is one snippet away</h2>
          <p className="mt-3 text-sm leading-7 text-t2">Add two lines to any function. Performance, cost, and reliability. Live in seconds.</p>
        </div>
        <div className="mt-8 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
          <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1">
            {platforms.map((p) => (
              <button key={p.id} onClick={() => setPlatform(p.id)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors ${platform === p.id ? "bg-surface text-accent border border-[var(--border)] shadow-sm" : "text-t2 hover:text-t1"}`}>
                {p.icon}{p.label}
              </button>
            ))}
          </div>
          <div className="relative mt-3">
            <pre className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4 font-mono text-xs leading-7 text-t2">{fullSnippet}</pre>
            <button onClick={copySnippet} className="absolute right-3 top-3 rounded-lg border border-[var(--border)] bg-surface px-2.5 py-1 text-[10px] font-medium text-t2 transition-colors hover:text-t1">{snippetCopied ? "Copied" : "Copy"}</button>
          </div>
          <p className="mt-3 text-center text-[11px] text-t2">Replace <code className="text-accent">http://localhost:8099</code> with your server URL. <a href="/connect" className="underline underline-offset-2 hover:text-t1">Full setup guide →</a></p>
        </div>
        <div className="mt-5 flex items-center justify-center gap-2.5 rounded-2xl border border-[var(--border)] bg-surface px-4 py-3">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <p className="text-xs text-t2">Waiting for your first event — dashboard will update automatically</p>
        </div>
      </div>
    </div>
  );
}

// ─── Live ticker ──────────────────────────────────────────────────────────────

function StatusBar({ totalRuns, agentCount, lastUpdated }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const secs = lastUpdated ? Math.floor((Date.now() - lastUpdated) / 1000) : null;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-surface px-4 py-2.5 shadow-card">
      <p className="text-xs text-t2 tabular-nums">
        <span className="font-medium text-t1">{totalRuns.toLocaleString()}</span> runs across <span className="font-medium text-t1">{agentCount}</span> agent{agentCount !== 1 ? "s" : ""}
        {secs !== null && (<span className="text-t3"> · refreshed {secs < 5 ? "just now" : `${secs}s ago`}</span>)}
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const [agents, setAgents]           = useState([]);
  const [namesMap, setNamesMap]       = useState({});
  const [recommendations, setRecs]    = useState([]);
  const [monthly, setMonthly]         = useState(null);
  const [weekCmp, setWeekCmp]         = useState(null);
  const [health, setHealth]           = useState(null);
  const [briefing, setBriefing]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [healthLoading, setHLoading]  = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("welcome") === "1";
  });

  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, recsRes, namesRes, monthlyRes, weekRes, healthRes, briefingRes] = await Promise.all([
        getAgents(),
        getRecommendations(),
        getAgentNames(),
        getMonthlyStats(),
        getWeekComparison().catch(() => ({ data: null })),
        getFleetHealth().catch(() => null),
        getFleetBriefing().catch(() => null),
      ]);
      setAgents(agentsRes.data);
      setRecs(recsRes.data);
      setNamesMap(namesRes.data);
      setMonthly(monthlyRes.data);
      if (weekRes.data)       setWeekCmp(weekRes.data);
      if (healthRes?.data)    setHealth(healthRes.data);
      if (briefingRes?.data)  setBriefing(briefingRes.data);
      setLastUpdated(Date.now());
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 401) {
        setAgents([]); setRecs([]);
      }
    } finally {
      setLoading(false);
      setHLoading(false);
    }
  }, []);

  usePolling(fetchData, 10_000);

  const totalRuns   = agents.reduce((s, a) => s + a.total_calls, 0);
  const totalFailed = agents.reduce((s, a) => s + a.failed, 0);
  const totalCost   = agents.reduce((s, a) => s + (a.total_cost ?? 0), 0);
  const fleetUptime = agents.length > 0 ? agents.reduce((s, a) => s + a.success_rate, 0) / agents.length : 0;
  const criticalCount = agents.filter((a) => healthOf(a) === "critical").length;
  const degradedCount = agents.filter((a) => healthOf(a) === "degraded").length;
  const issueCount    = criticalCount + degradedCount;

  const costTrend = monthly && monthly.last_month?.total_cost_usd > 0
    ? { up: monthly.this_month.total_cost_usd > monthly.last_month.total_cost_usd, pct: Math.abs(((monthly.this_month.total_cost_usd - monthly.last_month.total_cost_usd) / monthly.last_month.total_cost_usd) * 100).toFixed(0) }
    : null;

  const errorRateTrend = weekCmp?.delta?.error_rate_pct != null
    ? { up: weekCmp.delta.error_rate_pct > 0, pct: Math.abs(weekCmp.delta.error_rate_pct).toFixed(0) } : null;
  const runTrend = weekCmp?.delta?.runs_pct != null
    ? { up: weekCmp.delta.runs_pct > 0, pct: Math.abs(weekCmp.delta.runs_pct).toFixed(0) } : null;

  const topRec = recommendations[0] ?? null;
  const sortedByActivity = [...agents].sort((a, b) => new Date(b.last_seen ?? 0) - new Date(a.last_seen ?? 0));
  const issueAgents = [
    ...agents.filter((a) => healthOf(a) === "critical"),
    ...agents.filter((a) => healthOf(a) === "degraded"),
  ];

  const kpiIcon = (d) => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );

  return (
    <AppLayout>
      <Seo
        title="Overview | AgentMetrics"
        description="Agent health overview across your AI agents."
        path="/dashboard"
        app
        robots="noindex,nofollow"
      />

      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">

        {loading ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[...Array(5)].map((_, i) => <KPISkeleton key={i} />)}
          </section>
        ) : agents.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Live ticker + briefing */}
            <div className="fade-in-up flex flex-col gap-3">
              <StatusBar totalRuns={totalRuns} agentCount={agents.length} lastUpdated={lastUpdated} />
              <MorningBriefing briefing={briefing} loading={healthLoading} />
            </div>

            {/* Fleet Health Score + Issue Strip */}
            <div className="fade-in-up flex flex-col gap-3">
              <FleetScoreGauge health={health} loading={healthLoading} />
              <IssueStrip
                agents={issueAgents}
                namesMap={namesMap}
                onAgent={(id) => navigate(`/agents/${encodeURIComponent(id)}`)}
              />
            </div>

            {/* KPI strip */}
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <KPICard
                label="Uptime"
                value={`${fleetUptime.toFixed(1)}%`}
                sub={`${agents.length} agent${agents.length !== 1 ? "s" : ""} monitored`}
                icon={kpiIcon("M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z")}
                valueClass={fleetUptime >= 95 ? "text-savings" : fleetUptime >= 80 ? "text-cost" : "text-danger"}
                iconBg={fleetUptime >= 95 ? "bg-savings/10 text-savings" : fleetUptime >= 80 ? "bg-cost/10 text-cost" : "bg-danger/10 text-danger"}
                delay={0}
              />
              <KPICard
                label="Total runs"
                value={totalRuns.toLocaleString()}
                sub={weekCmp?.current?.runs != null ? `${weekCmp.current.runs.toLocaleString()} this week` : "Across all agents"}
                icon={kpiIcon("M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z")}
                valueClass="text-t1"
                iconBg="bg-accent/10 text-accent"
                trend={runTrend}
                delay={60}
              />
              <KPICard
                label="Failed runs"
                value={totalFailed.toLocaleString()}
                sub={weekCmp?.current?.error_rate != null ? `${(weekCmp.current.error_rate * 100).toFixed(1)}% error rate this week` : `${totalRuns > 0 ? ((totalFailed / totalRuns) * 100).toFixed(1) : 0}% failure rate`}
                icon={kpiIcon("M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z")}
                valueClass={totalFailed > 0 ? "text-danger" : "text-savings"}
                iconBg={totalFailed > 0 ? "bg-danger/10 text-danger" : "bg-savings/10 text-savings"}
                trend={errorRateTrend ? { up: errorRateTrend.up, pct: errorRateTrend.pct } : null}
                delay={120}
              />
              <KPICard
                label="This month"
                value={monthly ? fmtCost(monthly.this_month.total_cost_usd) : fmtCost(totalCost)}
                sub={monthly?.last_month?.total_cost_usd > 0 ? `vs ${fmtCost(monthly.last_month.total_cost_usd)} last month` : "Current calendar month"}
                icon={kpiIcon("M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z")}
                valueClass="text-cost"
                iconBg="bg-cost/10 text-cost"
                trend={costTrend}
                delay={180}
              />
              <KPICard
                label="Active issues"
                value={issueCount}
                sub={`${criticalCount} critical · ${degradedCount} degraded`}
                icon={kpiIcon("M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0")}
                valueClass={issueCount > 0 ? "text-danger" : "text-savings"}
                iconBg={issueCount > 0 ? "bg-danger/10 text-danger" : "bg-savings/10 text-savings"}
                delay={240}
              />
            </section>

            {/* Fleet health ring + cost chart */}
            <section className="grid gap-5 xl:grid-cols-2">
              <div className="fade-in-up delay-300 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
                <div className="mb-5 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-t2">Agent health</p>
                    <h2 className="mt-1 text-lg font-bold tracking-tight text-t1">Agent status breakdown</h2>
                  </div>
                  <a href="/cost" className="flex items-center gap-1 text-xs font-medium text-accent transition-opacity hover:opacity-75">
                    Insights
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                  </a>
                </div>
                <FleetHealthRing agents={agents} />
              </div>

              <div className="fade-in-up delay-300 rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card">
                <div className="mb-5 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-cost">Spend</p>
                    <h2 className="mt-1 text-lg font-bold tracking-tight text-t1">Cost by agent</h2>
                  </div>
                  <a href="/cost" className="flex items-center gap-1 text-xs font-medium text-cost/70 transition-colors hover:text-cost">
                    Full breakdown
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                  </a>
                </div>
                <CostBars agents={agents} namesMap={namesMap} onAgent={(id) => navigate(`/agents/${encodeURIComponent(id)}`)} />
              </div>
            </section>

            {/* Agent grid + right sidebar */}
            <section className="grid gap-5 xl:grid-cols-[1fr_320px]">
              <div className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-t2">All agents</p>
                    <h2 className="mt-1 text-lg font-bold tracking-tight text-t1">{agents.length} agent{agents.length !== 1 ? "s" : ""} monitored</h2>
                  </div>
                  <a href="/agents" className="flex items-center gap-1 text-xs font-medium text-t2 transition-colors hover:text-t1">
                    View all
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                  </a>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
                  {sortedByActivity.map((agent, i) => (
                    <AgentCard
                      key={agent.agent_id}
                      agent={agent}
                      name={displayName(agent.agent_id, namesMap)}
                      delay={i * 40}
                      onClick={() => navigate(`/agents/${encodeURIComponent(agent.agent_id)}`)}
                    />
                  ))}
                </div>
              </div>

              {/* Right column — top recommendation only */}
              <div className="flex flex-col gap-5">
                <div className={`rounded-[28px] border p-5 ${topRec ? "border-savings/20 bg-savings/[0.02]" : "border-[var(--border)] bg-surface"}`}>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-savings">Top opportunity</p>
                  <h2 className="mt-1 text-base font-bold text-t1">Recommendation</h2>
                  {topRec ? (
                    <>
                      <div className="mt-4"><RecCard rec={topRec} /></div>
                      <a href="/cost?tab=optimize" className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-75">
                        {recommendations.length > 1 ? `View all ${recommendations.length} recommendations` : "View recommendations"}
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                      </a>
                    </>
                  ) : (
                    <p className="mt-3 text-xs leading-relaxed text-t2">Recommendations unlock as your agents accumulate more runs.</p>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {showOnboarding && (
        <OnboardingOverlay onDismiss={() => {
          setShowOnboarding(false);
          const url = new URL(window.location.href);
          url.searchParams.delete("welcome");
          window.history.replaceState({}, "", url);
        }} />
      )}
    </AppLayout>
  );
}
