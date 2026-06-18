import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const STATIC_PAGES = [
  { id: "dashboard",   label: "Overview",       sub: "Dashboard & fleet health",     href: "/dashboard",         icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "agents",      label: "Agents",          sub: "All monitored agents",         href: "/agents",            icon: "M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.698-1.379 2.698H4.178c-1.408 0-2.38-1.697-1.379-2.698L4.2 15.3" },
  { id: "live",        label: "Live",            sub: "Real-time agent activity",     href: "/live",              icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
  { id: "cost",        label: "Cost",            sub: "Spend breakdown & trends",     href: "/cost",              icon: "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "alerts",      label: "Alerts",          sub: "Rules & alert history",        href: "/alerts",            icon: "M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" },
  { id: "connect",     label: "Integrations",    sub: "SDK setup & API keys",         href: "/connect",           icon: "M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" },
  { id: "account",     label: "Account",         sub: "Profile & settings",           href: "/account",           icon: "M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "optimize",    label: "Optimize",        sub: "Recommendations & savings",    href: "/cost?tab=optimize", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
  { id: "credentials", label: "API credentials", sub: "Keys & webhooks",             href: "/account?tab=credentials", icon: "M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" },
];

function NavIcon({ d }) {
  return (
    <svg className="h-4 w-4 shrink-0 text-t2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function AgentIcon() {
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[9px] font-bold text-accent">
      AG
    </div>
  );
}

export default function CommandPalette({ agents = [], namesMap = {}, isOpen, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery]             = useState("");
  const [debouncedQuery, setDebounced] = useState("");
  const [activeIdx, setActiveIdx]      = useState(0);
  const inputRef  = useRef(null);
  const listRef   = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const agentItems = agents.slice(0, 20).map((a) => ({
    id:   `agent:${a.agent_id}`,
    label: namesMap[a.agent_id] || a.agent_id,
    sub:  `${a.total_calls} runs · ${a.success_rate?.toFixed(1)}% success`,
    href:  `/agents/${encodeURIComponent(a.agent_id)}`,
    type:  "agent",
  }));

  const allItems = [...STATIC_PAGES.map((p) => ({ ...p, type: "page" })), ...agentItems];

  const filtered = debouncedQuery.trim()
    ? allItems.filter((item) =>
        item.label.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        (item.sub || "").toLowerCase().includes(debouncedQuery.toLowerCase())
      )
    : allItems;

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isOpen]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  const handleNavigate = useCallback((href) => {
    onClose();
    navigate(href);
  }, [onClose, navigate]);

  const handleKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[activeIdx]) {
      handleNavigate(filtered[activeIdx].href);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  useEffect(() => {
    const el = listRef.current?.children[activeIdx];
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-[560px] overflow-hidden rounded-2xl border border-[var(--border)] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3.5">
          <svg className="h-4 w-4 shrink-0 text-t2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Go to page or agent…"
            className="flex-1 bg-transparent text-sm text-t1 placeholder:text-t3 outline-none"
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 font-mono text-[10px] text-t3">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[360px] overflow-y-auto py-2"
        >
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-t2">No results for &quot;{query}&quot;</p>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => handleNavigate(item.href)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === activeIdx ? "bg-[var(--accent-bg)] text-accent" : "text-t1 hover:bg-[var(--surface-2)]"
                }`}
              >
                {item.type === "agent"
                  ? <AgentIcon />
                  : <NavIcon d={item.icon} />
                }
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  {item.sub && (
                    <p className="truncate text-[11px] text-t2">{item.sub}</p>
                  )}
                </div>
                {i === activeIdx && (
                  <kbd className="ml-auto shrink-0 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-t3">
                    ↵
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border)] px-4 py-2 flex items-center gap-4 text-[10px] text-t3">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
