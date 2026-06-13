export const docsNav = [
  {
    section: "Getting Started",
    items: [
      { title: "Overview",   href: "/docs" },
      { title: "Quickstart", href: "/docs/quickstart" },
    ],
  },
  {
    section: "SDK Reference",
    items: [
      { title: "Python SDK",     href: "/docs/sdk/python" },
      { title: "JavaScript SDK", href: "/docs/sdk/javascript" },
    ],
  },
  {
    section: "Integrations",
    items: [
      { title: "OpenClaw plugin", href: "/docs/integrations/openclaw" },
      { title: "Hermes",          href: "/docs/integrations/hermes" },
      { title: "LangChain",       href: "/docs/integrations/langchain",  badge: "Coming soon" },
      { title: "LlamaIndex",      href: "/docs/integrations/llamaindex", badge: "Coming soon" },
    ],
  },
  {
    section: "API Reference",
    items: [
      { title: "Overview",       href: "/docs/api/overview" },
      { title: "Authentication", href: "/docs/api/authentication" },
      { title: "Events",         href: "/docs/api/events" },
    ],
  },
];

export function flatNavItems() {
  return docsNav.flatMap((s) => s.items.filter((i) => !i.badge));
}

export function prevNext(pathname) {
  const items = flatNavItems();
  const idx = items.findIndex((i) => i.href === pathname);
  return {
    prev: idx > 0 ? items[idx - 1] : null,
    next: idx >= 0 && idx < items.length - 1 ? items[idx + 1] : null,
  };
}
