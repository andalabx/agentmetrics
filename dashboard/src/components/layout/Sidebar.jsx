import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Logo from "../Logo";

function DarkToggle({ collapsed }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };

  const SunIcon = (
    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
  const MoonIcon = (
    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );

  if (!mounted) return (
    <button className={`flex w-full items-center gap-3 rounded-xl py-2.5 text-t2 ${collapsed ? "justify-center px-2" : "px-3"}`}>
      <span className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="text-sm">Theme</span>}
    </button>
  );

  return (
    <button
      onClick={toggle}
      title={dark ? "Light mode" : "Dark mode"}
      className={`flex w-full items-center gap-3 rounded-xl py-2.5 text-sm text-t2 transition-colors hover:bg-[var(--surface-2)] hover:text-t1 ${collapsed ? "justify-center px-2" : "px-3"}`}
    >
      {dark ? SunIcon : MoonIcon}
      {!collapsed && <span>{dark ? "Light mode" : "Dark mode"}</span>}
    </button>
  );
}

const NAV_GROUPS = [
  {
    items: [
      {
        href: "/dashboard",
        label: "Overview",
        icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
      },
      {
        href: "/agents",
        label: "Agents",
        icon: "M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.698-1.379 2.698H4.178c-1.408 0-2.38-1.697-1.379-2.698L4.2 15.3",
      },
      {
        href: "/live",
        label: "Live",
        live: true,
        icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z",
      },
      {
        href: "/cost",
        label: "Cost",
        icon: "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      },
    ],
  },
  {
    divider: true,
    items: [
      {
        href: "/alerts",
        label: "Alerts",
        alerts: true,
        icon: "M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0",
      },
      {
        href: "/connect",
        label: "Integrations",
        icon: "M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z",
      },
      {
        href: "/account",
        label: "Account",
        icon: "M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z",
      },
    ],
  },
];

export default function Sidebar({ isMobileOpen = false, onMobileClose = () => {}, isCollapsed = false, onToggleCollapsed = () => {}, alertCount = 0, onOpenCommandPalette = () => {} }) {
  const { pathname } = useLocation();

  const isActive = (href) => {
    const base = href.split("?")[0];
    return base === "/dashboard"
      ? pathname === base || pathname === "/"
      : pathname === base || pathname.startsWith(base + "/");
  };

  const linkCls = (href) =>
    `group relative flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
      isCollapsed ? "justify-center px-2" : "px-3"
    } ${
      isActive(href)
        ? "bg-[var(--accent-bg)] text-accent"
        : "text-t2 hover:bg-[var(--surface-2)] hover:text-t1"
    }`;

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  const kbdLabel = isMac ? "⌘K" : "Ctrl K";

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity md:hidden ${
          isMobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen flex-col border-r border-[var(--border)] bg-surface transition-all duration-300 ease-in-out
          md:sticky md:top-0 md:z-auto
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          ${isCollapsed ? "w-[60px]" : "w-64 max-w-[86vw] md:max-w-none"}
        `}
      >
        {/* Logo header */}
        <div className={`flex h-14 shrink-0 items-center border-b border-[var(--border)] ${isCollapsed ? "justify-center" : "px-4"}`}>
          {isCollapsed ? (
            <Link to="/dashboard" onClick={onMobileClose}>
              <Logo markSize={24} />
            </Link>
          ) : (
            <div className="flex w-full items-center justify-between">
              <Link to="/dashboard" onClick={onMobileClose}>
                <Logo markSize={26} showWordmark mono />
              </Link>
              <button
                type="button"
                onClick={onMobileClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-t2 transition-colors hover:text-t1 md:hidden"
                aria-label="Close navigation"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Command palette trigger */}
        {!isCollapsed && (
          <div className="px-2 pt-2">
            <button
              onClick={onOpenCommandPalette}
              className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-t2 transition-colors hover:border-[var(--border-strong)] hover:text-t1"
            >
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <span className="flex-1 text-left">Quick navigate…</span>
              <kbd className="font-mono text-[10px] text-t3">{kbdLabel}</kbd>
            </button>
          </div>
        )}
        {isCollapsed && (
          <div className="px-2 pt-2">
            <button
              onClick={onOpenCommandPalette}
              title="Quick navigate (Ctrl+K)"
              className="flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 text-t2 transition-colors hover:text-t1"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </button>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.divider && (
                <div className="my-2 mx-1 border-t border-[var(--border)]" />
              )}
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon, alerts, live }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={onMobileClose}
                    title={isCollapsed ? label : undefined}
                    className={linkCls(href)}
                  >
                    <span className="relative shrink-0">
                      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
                      </svg>
                      {alerts && alertCount > 0 && isCollapsed && (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[8px] font-bold text-white">
                          {alertCount > 9 ? "9+" : alertCount}
                        </span>
                      )}
                      {live && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                      )}
                    </span>
                    {!isCollapsed && <span className="flex-1 truncate">{label}</span>}
                    {!isCollapsed && alerts && alertCount > 0 && (
                      <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                        {alertCount > 9 ? "9+" : alertCount}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom: theme toggle */}
        <div className="shrink-0 border-t border-[var(--border)] px-2 py-2">
          <DarkToggle collapsed={isCollapsed} />
        </div>

        {/* Collapse tab - desktop only */}
        <button
          onClick={onToggleCollapsed}
          title={isCollapsed ? "Expand" : "Collapse"}
          className="absolute -right-3 top-[72px] hidden md:flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] bg-surface text-t2 shadow-sm transition-colors hover:bg-[var(--surface-2)] hover:text-t1 z-10"
        >
          <svg
            className={`h-3 w-3 transition-transform duration-300 ${isCollapsed ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </aside>
    </>
  );
}
