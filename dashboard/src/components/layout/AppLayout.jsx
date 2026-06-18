import PropTypes from "prop-types";
import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import Logo from "../Logo";
import Sidebar from "./Sidebar";
import CommandPalette from "../CommandPalette";
import { useToast } from "../../context/ToastContext";
import { getAlertHistory } from "../../api/alerts";
import { getAgents, getAgentNames } from "../../api/agents";

export default function AppLayout({ children }) {
  const [isMobileOpen, setIsMobileOpen]   = useState(false);
  const [isCollapsed, setIsCollapsed]     = useState(false);
  const [alertCount, setAlertCount]       = useState(0);
  const [paletteOpen, setPaletteOpen]     = useState(false);
  const [paletteAgents, setPaletteAgents] = useState([]);
  const [paletteNames, setPaletteNames]   = useState({});
  const alertIntervalRef                  = useRef(null);
  const { addToast } = useToast();

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar_collapsed");
      if (saved === "true") setIsCollapsed(true);
    } catch {}
  }, []);

  const fetchAlertCount = async () => {
    try {
      const res = await getAlertHistory();
      const events = res?.data ?? [];
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const recent = events.filter((e) => new Date(e.fired_at).getTime() >= cutoff);
      setAlertCount(recent.length);
    } catch {}
  };

  useEffect(() => {
    fetchAlertCount();
    alertIntervalRef.current = setInterval(fetchAlertCount, 60_000);
    return () => clearInterval(alertIntervalRef.current);
  }, []);

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      try { localStorage.setItem("sidebar_collapsed", String(!prev)); } catch {}
      return !prev;
    });
  };

  useEffect(() => {
    if (!isMobileOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isMobileOpen]);

  useEffect(() => {
    const handler = () => {
      addToast({ type: "error", message: "A server error occurred. Please try again." });
    };
    window.addEventListener("api:error", handler);
    return () => window.removeEventListener("api:error", handler);
  }, [addToast]);

  const openPalette = useCallback(async () => {
    setPaletteOpen(true);
    if (paletteAgents.length === 0) {
      try {
        const [agentsRes, namesRes] = await Promise.all([getAgents(), getAgentNames()]);
        setPaletteAgents(agentsRes.data ?? []);
        setPaletteNames(namesRes.data ?? {});
      } catch {}
    }
  }, [paletteAgents.length]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openPalette]);

  return (
    <div className="min-h-screen bg-bg md:flex">
      <Sidebar
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
        isCollapsed={isCollapsed}
        onToggleCollapsed={toggleCollapsed}
        alertCount={alertCount}
        onOpenCommandPalette={openPalette}
      />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/95 px-4 py-3 backdrop-blur md:hidden">
          <Link to="/dashboard"><Logo markSize={26} showWordmark /></Link>
          <button
            type="button"
            onClick={() => setIsMobileOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-surface text-t2 transition-colors hover:text-t1"
            aria-label="Open navigation"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        agents={paletteAgents}
        namesMap={paletteNames}
      />
    </div>
  );
}

AppLayout.propTypes = {
  children: PropTypes.node.isRequired,
};
