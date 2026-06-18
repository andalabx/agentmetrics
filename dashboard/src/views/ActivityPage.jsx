import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { getAgents } from "../api/agents";
import { openActivityStream } from "../api/stream";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";

const MAX_EVENTS = 200;

function timeSince(tsMs) {
  if (!tsMs) return "—";
  const s = Math.floor((Date.now() - tsMs) / 1000);
  if (s < 5)    return "just now";
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtCost(v) {
  if (v == null) return null;
  if (v < 0.0001) return `$${v.toFixed(6)}`;
  if (v < 0.01)   return `$${v.toFixed(4)}`;
  if (v < 1)      return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

function fmtLatency(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(str, n) {
  if (!str) return "—";
  return str.length > n ? str.slice(0, n) + "…" : str;
}


const EVENT_META = {
  run_start:      { label: "run_start",      color: "text-indigo-400",  bg: "bg-indigo-500/10"  },
  run_end:        { label: "run_end",        color: "text-indigo-400",  bg: "bg-indigo-500/10"  },
  llm_start:      { label: "llm_start",      color: "text-purple-400",  bg: "bg-purple-500/10"  },
  llm_end:        { label: "llm_end",        color: "text-purple-400",  bg: "bg-purple-500/10"  },
  tool_start:     { label: "tool_start",     color: "text-amber-400",   bg: "bg-amber-500/10"   },
  tool_end:       { label: "tool_end",       color: "text-amber-400",   bg: "bg-amber-500/10"   },
  compaction:     { label: "compaction",     color: "text-orange-400",  bg: "bg-orange-500/10"  },
  reset:          { label: "reset",          color: "text-red-400",     bg: "bg-red-500/10"     },
  gateway_start:  { label: "gateway_start",  color: "text-cyan-400",    bg: "bg-cyan-500/10"    },
  gateway_stop:   { label: "gateway_stop",   color: "text-cyan-400",    bg: "bg-cyan-500/10"    },
  subagent_start: { label: "subagent_start", color: "text-teal-400",    bg: "bg-teal-500/10"    },
  subagent_end:   { label: "subagent_end",   color: "text-teal-400",    bg: "bg-teal-500/10"    },
};

function getEventMeta(type) {
  return EVENT_META[type] ?? { label: type, color: "text-t3", bg: "bg-[var(--surface-2)]" };
}


function DataPreview({ type, data }) {
  if (!data) return null;

  if (type === "llm_end") {
    const parts = [];
    if (data.tokens != null) parts.push(`${data.tokens.toLocaleString()} tok`);
    const cost = fmtCost(data.cost_usd);
    if (cost) parts.push(cost);
    if (!parts.length) return null;
    return <span className="text-xs text-t3">{parts.join(" · ")}</span>;
  }

  if (type === "tool_end") {
    const parts = [];
    const dur = fmtLatency(data.duration_ms);
    if (dur) parts.push(dur);
    if (data.error) parts.push(<span key="err" className="text-red-400">error</span>);
    if (!parts.length) return null;
    return (
      <span className="text-xs text-t3 flex items-center gap-1">
        {parts.map((p, i) => <React.Fragment key={i}>{i > 0 && " · "}{p}</React.Fragment>)}
      </span>
    );
  }

  if (type === "run_end") {
    const parts = [];
    const cost = fmtCost(data.cost_usd);
    if (cost) parts.push(cost);
    if (data.error) parts.push(<span key="err" className="text-red-400">failed</span>);
    else if (cost) parts.push(<span key="ok" className="text-emerald-400">ok</span>);
    if (!parts.length) return null;
    return (
      <span className="text-xs text-t3 flex items-center gap-1">
        {parts.map((p, i) => <React.Fragment key={i}>{i > 0 && " · "}{p}</React.Fragment>)}
      </span>
    );
  }

  if (type === "tool_start" && data.tool_name) {
    return <span className="text-xs text-t3 font-mono">{data.tool_name}</span>;
  }

  if (type === "llm_start" && data.model) {
    return <span className="text-xs text-t3">{data.model}</span>;
  }

  return null;
}

DataPreview.propTypes = {
  type: PropTypes.string.isRequired,
  data: PropTypes.object,
};


function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface px-4 py-3">
      <p className="text-xs text-t3 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${accent ? "text-emerald-400" : "text-t1"}`}>{value}</p>
    </div>
  );
}

StatCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  accent: PropTypes.bool,
};

function ConnectionBadge({ status }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
      </span>
      Reconnecting…
    </span>
  );
}

ConnectionBadge.propTypes = {
  status: PropTypes.string.isRequired,
};

function EventRow({ event, tick }) {
  const meta = getEventMeta(event.type);
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] transition-colors">
      <span
        className={`shrink-0 mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium font-mono ${meta.color} ${meta.bg}`}
      >
        {meta.label}
      </span>

      <span className="shrink-0 text-sm text-t2 font-mono min-w-[120px] truncate">
        {truncate(event.agent_id, 20)}
      </span>

      <div className="flex-1 min-w-0">
        <DataPreview type={event.type} data={event.data} />
      </div>

      <span key={tick} className="shrink-0 text-xs text-t3 tabular-nums whitespace-nowrap">
        {timeSince(event.ts)}
      </span>
    </div>
  );
}

EventRow.propTypes = {
  event: PropTypes.shape({
    type: PropTypes.string.isRequired,
    agent_id: PropTypes.string,
    data: PropTypes.object,
    ts: PropTypes.number,
  }).isRequired,
  tick: PropTypes.number.isRequired,
};

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="relative flex h-10 w-10 items-center justify-center">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--surface-3)] opacity-50" />
        <span className="relative inline-flex h-6 w-6 rounded-full bg-[var(--surface-3)]" />
      </div>
      <div>
        <p className="text-sm font-medium text-t1">Waiting for agent activity…</p>
        <p className="mt-0.5 text-xs text-t3">Events will appear here as your agents run.</p>
      </div>
      <Link to="/connect" className="mt-1 text-xs font-medium text-accent hover:underline">
        View integrations →
      </Link>
    </div>
  );
}


export default function ActivityPage() {
  const [agents, setAgents]           = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [events, setEvents]           = useState([]);
  const [connStatus, setConnStatus]   = useState("reconnecting");
  const [tick, setTick]               = useState(0);

  // Single fetch on mount for server-side aggregates (run_count, success_rate, last_run_at).
  // These are not emitted over the SSE stream; polling was replaced with a one-time load
  // and SSE-derived incremental counters to avoid continuous HTTP traffic.
  useEffect(() => {
    getAgents()
      .then((res) => setAgents(res.data?.agents ?? res.data ?? []))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  useEffect(() => {
    const stream = openActivityStream(
      (event) => {
        setEvents((prev) => {
          const next = [event, ...prev];
          return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
        });
      },
      (err) => {
        console.warn("[ActivityPage] SSE error", err);
      },
      (status) => {
        setConnStatus(status);
      }
    );

    return () => stream.cleanup();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const eventsToday = events.filter((e) => e.ts >= todayStart.getTime()).length;

  // Blend initial snapshot with agents seen in the live SSE stream this hour.
  const activeLastHour = new Set([
    ...agents
      .filter((a) => a.last_run_at && new Date(a.last_run_at).getTime() >= oneHourAgo)
      .map((a) => a.agent_id ?? a.id),
    ...events
      .filter((e) => e.ts >= oneHourAgo && e.agent_id)
      .map((e) => e.agent_id),
  ]).size;

  // SSE run_end events add to the initial run count from the server snapshot.
  const sseRunEnds  = events.filter((e) => e.type === "run_end");
  const totalRuns   = agents.reduce((s, a) => s + (a.run_count ?? 0), 0) + sseRunEnds.length;

  const avgSuccess = agents.length
    ? Math.round(agents.reduce((s, a) => s + (a.success_rate ?? 0), 0) / agents.length)
    : null;

  return (
    <AppLayout>
      <Seo title="Activity — AgentMetrics" />
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">

        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-t1">Activity</h1>
            <ConnectionBadge status={connStatus} />
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Events today"    value={eventsToday.toLocaleString()} accent />
          <StatCard label="Active last hour" value={statsLoading ? "—" : activeLastHour} />
          <StatCard
            label="Avg success rate"
            value={statsLoading || avgSuccess == null ? "—" : `${avgSuccess}%`}
          />
          <StatCard
            label="Total runs"
            value={statsLoading ? "—" : totalRuns.toLocaleString()}
          />
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-surface overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3 flex items-center justify-between">
            <p className="text-sm font-medium text-t1">Live event feed</p>
            {events.length > 0 && (
              <span className="text-xs text-t3">{events.length} events</span>
            )}
          </div>

          {events.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="divide-y-0">
              {events.map((event, idx) => (
                <EventRow key={`${event.ts}-${idx}`} event={event} tick={tick} />
              ))}
            </div>
          )}
        </div>

      </div>
    </AppLayout>
  );
}
