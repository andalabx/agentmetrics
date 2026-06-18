import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getAgents, deleteAgent, getAgentNames, renameAgent } from "../api/agents";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";
import usePolling from "../hooks/usePolling";
import AgentDetailPanel from "../components/AgentDetailPanel";
import { agentDisplayName, timeSince, healthOf } from "../lib/helpers";

const statusConfig = {
  healthy:  { color: "text-savings", bg: "border-savings/25 bg-savings/[0.05]", dot: "bg-savings",  label: "Healthy" },
  degraded: { color: "text-cost",    bg: "border-cost/25 bg-cost/[0.05]",       dot: "bg-cost",     label: "Degraded" },
  critical: { color: "text-danger",  bg: "border-danger/25 bg-danger/[0.05]",   dot: "bg-danger",   label: "Critical" },
};

function AgentRowSkeleton() {
  return (
    <div className="w-full animate-pulse rounded-[28px] border border-[var(--border)] bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 shrink-0 rounded-2xl bg-[var(--surface-2)]" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-[var(--surface-2)]" />
          <div className="h-3 w-24 rounded bg-[var(--surface-2)]" />
        </div>
        <div className="hidden sm:flex gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-1.5 text-center">
              <div className="mx-auto h-2.5 w-8 rounded bg-[var(--surface-2)]" />
              <div className="mx-auto h-4 w-10 rounded bg-[var(--surface-2)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentRow({ agent, namesMap, onClick, onDelete, onRename }) {
  const h = healthOf(agent.success_rate);
  const cfg = statusConfig[h];
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete all data for agent "${agent.agent_id}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteAgent(agent.agent_id);
      onDelete(agent.agent_id);
    } catch {
      setDeleting(false);
    }
  };

  const startRename = (e) => {
    e.stopPropagation();
    setNameInput(namesMap[agent.agent_id] || "");
    setRenaming(true);
  };

  const cancelRename = (e) => {
    e?.stopPropagation();
    setRenaming(false);
  };

  const submitRename = async (e) => {
    e.stopPropagation();
    setSavingName(true);
    try {
      const { data } = await renameAgent(agent.agent_id, nameInput);
      onRename(data);
      setRenaming(false);
    } finally {
      setSavingName(false);
    }
  };

  const label = agentDisplayName(agent.agent_id, namesMap);
  const hasCustomName = !!namesMap[agent.agent_id];

  return (
    <div className="group relative w-full rounded-[28px] border border-[var(--border)] bg-surface shadow-card transition-all hover:border-accent/30 hover:shadow-lg">
      <button
        onClick={onClick}
        className="w-full p-5 text-left sm:p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

          {/* Left: identity */}
          <div className="flex items-start gap-4">
            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${cfg.bg}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot} ${h === "critical" ? "animate-pulse" : ""}`} />
            </div>
            <div>
              <p className="text-base font-semibold text-t1 transition-colors group-hover:text-accent">{label}</p>
              {hasCustomName && (
                <p className="font-mono text-[10px] text-t2">{agent.agent_id}</p>
              )}
              <p className="mt-0.5 text-xs text-t2">
                {agent.last_seen ? `Last event ${timeSince(agent.last_seen)}` : "No events yet"}
              </p>
            </div>
          </div>

          {/* Right: metrics */}
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:gap-6">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-[0.14em] text-t2">Uptime</p>
              <p className={`mt-1 text-sm font-bold ${cfg.color}`}>{agent.success_rate.toFixed(1)}%</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-[0.14em] text-t2">Runs</p>
              <p className="mt-1 text-sm font-bold text-t1">{agent.total_calls.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-[0.14em] text-t2">Cost</p>
              <p className="mt-1 text-sm font-bold font-mono text-cost">${agent.total_cost.toFixed(4)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-[0.14em] text-t2">Failed</p>
              <p className={`mt-1 text-sm font-bold ${agent.failed > 0 ? "text-danger" : "text-savings"}`}>
                {agent.failed.toLocaleString()}
              </p>
            </div>
            <div className="hidden sm:block">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${cfg.bg} ${cfg.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
            </div>
            <div className="hidden sm:flex items-center text-t2 transition-colors group-hover:text-accent">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </button>

      {/* Inline rename form */}
      {renaming && (
        <div className="border-t border-[var(--border)] px-5 py-4 sm:px-6" onClick={(e) => e.stopPropagation()}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-t2">Rename agent</p>
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitRename(e); if (e.key === "Escape") cancelRename(e); }}
              placeholder={`e.g. Research Agent`}
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-t1 placeholder:text-t2 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <button
              onClick={submitRename}
              disabled={savingName}
              className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-txt transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {savingName ? "Saving..." : "Save"}
            </button>
            <button
              onClick={cancelRename}
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-medium text-t2 transition-colors hover:text-t1"
            >
              Cancel
            </button>
            {hasCustomName && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  setSavingName(true);
                  try {
                    const { data } = await renameAgent(agent.agent_id, "");
                    onRename(data);
                    setRenaming(false);
                  } finally { setSavingName(false); }
                }}
                className="text-xs text-t2 underline transition-colors hover:text-danger"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="absolute right-4 top-4 flex items-center gap-1 opacity-100 sm:opacity-0 sm:transition-all sm:group-hover:opacity-100 sm:right-5 sm:top-5">
        <button
          onClick={startRename}
          className="rounded-xl border border-[var(--border)] p-1.5 text-t2 transition-colors hover:border-accent/40 hover:text-accent"
          title="Rename agent"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-xl border border-[var(--border)] p-1.5 text-t2 transition-all hover:border-danger/40 hover:text-danger disabled:opacity-40"
          title="Delete agent"
        >
          {deleting ? (
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a1 1 0 011-1h4a1 1 0 011 1m-6 0h6" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "cost_desc",    label: "Cost: high → low" },
  { value: "cost_asc",     label: "Cost: low → high" },
  { value: "uptime_asc",   label: "Uptime: worst first" },
  { value: "uptime_desc",  label: "Uptime: best first" },
  { value: "failures_desc",label: "Most failures" },
  { value: "runs_desc",    label: "Most runs" },
  { value: "recent",       label: "Recently active" },
];

function sortAgents(agents, sortKey) {
  const copy = [...agents];
  switch (sortKey) {
    case "cost_desc":     return copy.sort((a, b) => b.total_cost - a.total_cost);
    case "cost_asc":      return copy.sort((a, b) => a.total_cost - b.total_cost);
    case "uptime_asc":    return copy.sort((a, b) => a.success_rate - b.success_rate);
    case "uptime_desc":   return copy.sort((a, b) => b.success_rate - a.success_rate);
    case "failures_desc": return copy.sort((a, b) => b.failed - a.failed);
    case "runs_desc":     return copy.sort((a, b) => b.total_calls - a.total_calls);
    case "recent":        return copy.sort((a, b) => new Date(b.last_seen || 0) - new Date(a.last_seen || 0));
    default:              return copy;
  }
}

export default function AgentsPage() {
  const navigate   = useNavigate();
  const params     = useParams();
  const selectedId = params.agentId ? decodeURIComponent(params.agentId) : null;

  const [agents, setAgents] = useState([]);
  const [namesMap, setNamesMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("cost_desc");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchAgents = useCallback(async () => {
    try {
      const [agentsRes, namesRes] = await Promise.all([getAgents(), getAgentNames()]);
      setAgents(agentsRes.data);
      setNamesMap(namesRes.data);
      setError(null);
    } catch (err) {
      if (err.response?.status === 401) {
        setAgents([]);
      } else {
        setAgents((prev) => {
          if (prev.length === 0) return prev;
          setError("Failed to refresh agents");
          return prev;
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(fetchAgents, 10_000);

  const handleDelete = (agentId) => {
    setAgents((prev) => prev.filter((a) => a.agent_id !== agentId));
  };

  const handleRename = (newNamesMap) => {
    setNamesMap(newNamesMap);
  };

  const idleAgents = agents.filter((a) => {
    const secs = a.last_seen ? Math.floor((Date.now() - new Date(a.last_seen)) / 1000) : Infinity;
    return secs > 3600;
  });

  const filtered = sortAgents(
    agents.filter((a) => {
      if (statusFilter !== "all") {
        if (statusFilter === "idle") {
          const secs = a.last_seen ? Math.floor((Date.now() - new Date(a.last_seen)) / 1000) : Infinity;
          if (secs <= 3600) return false;
        } else if (healthOf(a.success_rate) !== statusFilter) {
          return false;
        }
      }
      if (!search.trim()) return true;
      return (
        a.agent_id.toLowerCase().includes(search.toLowerCase()) ||
        agentDisplayName(a.agent_id, namesMap).toLowerCase().includes(search.toLowerCase())
      );
    }),
    sortKey,
  );

  const healthy  = agents.filter((a) => healthOf(a.success_rate) === "healthy").length;
  const degraded = agents.filter((a) => healthOf(a.success_rate) === "degraded").length;
  const critical = agents.filter((a) => healthOf(a.success_rate) === "critical").length;

  return (
    <AppLayout>
      <Seo
        title="Agents | AgentMetrics"
        description="All tracked AI agents with full health, cost, and reliability metrics."
        path="/agents"
        app
        robots="noindex,nofollow"
      />

      {/* Master-detail wrapper: side-by-side on xl, stacked on smaller screens */}
      <div className={`flex h-[calc(100vh-56px)] ${selectedId ? "xl:overflow-hidden" : ""}`}>

        {/* LEFT: agent list — hides on mobile when panel is open */}
        <div className={`flex flex-col overflow-y-auto ${
          selectedId
            ? "hidden xl:flex xl:w-[420px] xl:shrink-0 xl:border-r xl:border-[var(--border)]"
            : "flex-1"
        }`}>
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">

            {/* Header */}
            <section className="rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card sm:p-7">
              <h1 className="text-3xl font-bold tracking-tight text-t1 sm:text-4xl">All agents</h1>
              <p className="mt-2 text-sm leading-7 text-t2">
                Every tracked agent. Click any agent to open its detail view.
              </p>
            </section>

            {error && (
              <div className="rounded-2xl border border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger">{error}</div>
            )}

            {/* Status filter chips */}
            {agents.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "all",      label: "All",      count: agents.length,                             cls: "" },
                  { id: "healthy",  label: "Healthy",  count: agents.filter((a) => healthOf(a.success_rate) === "healthy").length,  cls: "text-savings border-savings/30 bg-savings/[0.06]" },
                  { id: "degraded", label: "Degraded", count: agents.filter((a) => healthOf(a.success_rate) === "degraded").length, cls: "text-cost border-cost/30 bg-cost/[0.06]" },
                  { id: "critical", label: "Critical", count: agents.filter((a) => healthOf(a.success_rate) === "critical").length, cls: "text-danger border-danger/30 bg-danger/[0.06]" },
                  { id: "idle",     label: "Idle",     count: idleAgents.length,                         cls: "text-t2 border-[var(--border)]" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className={`rounded-xl border px-4 py-2 text-xs font-semibold transition-all duration-150 ${
                      statusFilter === f.id
                        ? f.cls || "border-accent/30 bg-[var(--accent-bg)] text-accent"
                        : "border-[var(--border)] bg-surface text-t2 hover:text-t1"
                    }`}
                  >
                    {f.label}
                    {f.count > 0 && <span className="ml-1.5 opacity-60">({f.count})</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Search + Sort */}
            {agents.length > 0 && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-t2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search agents..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-2xl border border-[var(--border)] bg-surface py-3 pl-11 pr-4 text-sm text-t1 placeholder:text-t2 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                </div>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  className="rounded-2xl border border-[var(--border)] bg-surface py-3 pl-4 pr-8 text-sm text-t1 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50 sm:w-52"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            {loading ? (
              <div className="flex flex-col gap-3">
                {[...Array(4)].map((_, i) => <AgentRowSkeleton key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              agents.length === 0 ? (
                <div className="rounded-[28px] border border-[var(--border)] bg-surface p-10 text-center shadow-card">
                  <p className="text-t2">No agents tracked yet.</p>
                  <a
                    href="/connect"
                    className="mt-3 inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90"
                  >
                    Instrument your first agent
                  </a>
                </div>
              ) : (
                <div className="rounded-[28px] border border-[var(--border)] bg-surface p-10 text-center shadow-card">
                  <p className="text-t2">
                    {search.trim() ? `No agents matching "${search}"` : `No ${statusFilter} agents`}
                  </p>
                </div>
              )
            ) : (
              <div className="flex flex-col gap-3">
                {filtered.map((agent, i) => (
                  <div
                    key={agent.agent_id}
                    className="fade-in-up"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <AgentRow
                      agent={agent}
                      namesMap={namesMap}
                      onClick={() => navigate(`/agents/${encodeURIComponent(agent.agent_id)}`)}
                      onDelete={handleDelete}
                      onRename={handleRename}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: detail panel — slides in when an agent is selected */}
        {selectedId && (
          <>
            {/* Mobile: full-screen overlay with back button */}
            <div className="flex flex-1 flex-col xl:hidden">
              <div className="flex items-center gap-3 border-b border-[var(--border)] bg-surface px-4 py-3">
                <button
                  onClick={() => navigate("/agents")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-t2 transition-colors hover:text-t1"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                  </svg>
                  All agents
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <AgentDetailPanel agentId={selectedId} onClose={() => navigate("/agents")} />
              </div>
            </div>

            {/* Desktop: right panel beside the list */}
            <div className="hidden xl:flex xl:flex-1 xl:overflow-hidden">
              <AgentDetailPanel agentId={selectedId} onClose={() => navigate("/agents")} />
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
