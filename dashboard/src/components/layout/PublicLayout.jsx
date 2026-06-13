import React from "react";
import Logo from "../Logo";

function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };
  const SunIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
  const MoonIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex items-center justify-center rounded-lg border border-[var(--border)] p-2 text-t2 transition-colors hover:text-t1 hover:bg-[var(--surface-2)]"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

const NAV_LINKS = [
  { label: "Docs",         href: "/docs" },
  { label: "Pricing",      href: "/pricing" },
  { label: "Integrations", href: "/integrations" },
  { label: "Changelog",    href: "/changelog" },
];

function PublicHeader() {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-bg/90 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="flex items-center justify-between py-3.5">
          <a href="/"><Logo markSize={28} showWordmark wordmarkColor="var(--text-1)" /></a>

          <nav className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map(({ label, href }) => (
              <a key={label} href={href}
                className="text-sm text-t2 transition-colors hover:text-t1">
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <a href="https://github.com/andalabx/agentmetrics-sdk" target="_blank" rel="noreferrer"
              aria-label="GitHub"
              className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg text-t2 transition-colors hover:text-t1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
            <a href="https://app.agentmetrics.dev/login"
              className="hidden sm:block text-sm text-t2 transition-colors hover:text-t1 px-2">
              Sign in
            </a>
            <a href="https://app.agentmetrics.dev/signup"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90 active:opacity-75 [touch-action:manipulation]">
              Start free
            </a>
            <ThemeToggle />
            {/* Hamburger - mobile only */}
            <button
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Toggle menu"
              className="md:hidden flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-t2 transition-colors hover:text-t1"
            >
              {mobileOpen ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-bg/95 backdrop-blur-md px-5 py-4">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-t2 transition-colors hover:bg-[var(--surface-2)] hover:text-t1"
              >
                {label}
              </a>
            ))}
            <div className="mt-3 border-t border-[var(--border)] pt-3 flex flex-col gap-2">
              <a
                href="https://app.agentmetrics.dev/login"
                className="rounded-lg px-3 py-3 text-sm font-medium text-t2 transition-colors hover:bg-[var(--surface-2)] hover:text-t1"
              >
                Sign in
              </a>
              <a
                href="https://app.agentmetrics.dev/signup"
                className="rounded-lg bg-accent px-3 py-2.5 text-center text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90"
              >
                Start free
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-[var(--border)] bg-bg pt-16 pb-8">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">

          <div>
            <a href="/"><Logo markSize={26} showWordmark wordmarkColor="var(--text-1)" /></a>
            <p className="mt-4 text-sm leading-6 text-t2 max-w-[220px]">
              Observability for AI Agents. Monitor every run, every failure, every dollar.
            </p>
            <div className="mt-5 flex items-center gap-3">
              {[
                { href: "https://github.com/andalabx/agentmetrics-sdk", label: "GitHub",
                  path: "M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" },
                { href: "https://x.com/useagentmetrics", label: "X",
                  path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" },
              ].map(({ href, label, path }) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={label}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-t2 transition-colors hover:text-t1 hover:border-[var(--accent)]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d={path}/></svg>
                </a>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-t2">Product</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {[
                { label: "Docs",          href: "/docs" },
                { label: "API reference", href: "/docs/api/overview" },
                { label: "Integrations",  href: "/integrations" },
                { label: "Changelog",     href: "/changelog", badge: "New" },
                { label: "Status",        href: "/status",    badge: "Operational", badgeColor: "text-savings" },
                { label: "Pricing",       href: "/pricing" },
              ].map(({ label, href, external, badge, badgeColor }) => (
                <li key={label}>
                  <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="flex items-center gap-2 text-sm text-t2 transition-colors hover:text-t1">
                    {label}
                    {badge && <span className={`text-[10px] font-semibold ${badgeColor || "text-accent"}`}>{badge}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-t2">Developers</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {[
                { label: "Quickstart",     href: "/docs/quickstart" },
                { label: "Python SDK",     href: "/docs/sdk/python" },
                { label: "JavaScript SDK", href: "/docs/sdk/javascript" },
                { label: "OpenClaw plugin", href: "/integrations/openclaw" },
                { label: "Hermes plugin",  href: "/integrations/hermes" },
                { label: "GitHub",         href: "https://github.com/andalabx/agentmetrics-sdk", external: true },
              ].map(({ label, href, external }) => (
                <li key={label}>
                  <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="text-sm text-t2 transition-colors hover:text-t1">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-t2">Resources</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {[
                { label: "Blog",       href: "/blog" },
                { label: "Use cases",  href: "/use-cases" },
                { label: "Security",   href: "/security" },
                { label: "Community",  href: "/community" },
                { label: "Support",    href: "/support" },
              ].map(({ label, href }) => (
                <li key={label}>
                  <a href={href} className="text-sm text-t2 transition-colors hover:text-t1">{label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-t2">Company</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {[
                { label: "About",   href: "/about" },
                { label: "Contact", href: "/contact" },
              ].map(({ label, href }) => (
                <li key={label}>
                  <a href={href} className="text-sm text-t2 transition-colors hover:text-t1">{label}</a>
                </li>
              ))}
              <li>
                <a href="mailto:hi@agentmetrics.dev" className="text-sm text-t2 transition-colors hover:text-t1">
                  hi@agentmetrics.dev
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 border-t border-[var(--border)] pt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-t2">
            © {new Date().getFullYear()} AgentMetrics. All rights reserved. Built for developers building with AI agents.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              { label: "Privacy",       href: "/privacy" },
              { label: "Terms",         href: "/terms" },
              { label: "Refund Policy", href: "/refund" },
              { label: "Security",      href: "/security" },
            ].map(({ label, href }) => (
              <a key={label} href={href} className="text-xs text-t2 transition-colors hover:text-t1">{label}</a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function PublicLayout({ children }) {
  return (
    <>
      <PublicHeader />
      {children}
      <PublicFooter />
    </>
  );
}
