import { useEffect } from "react";

const DEFAULT_TITLE = "AgentMetrics | Observability for AI Agents";
const DEFAULT_DESCRIPTION =
  "Full visibility into your AI agents. Track cost, latency, token usage, failures, tool calls across LangChain, CrewAI, OpenClaw, Hermes and more.";
const DEFAULT_OG_DESCRIPTION =
  "Your AI agents are running blind. AgentMetrics gives you full visibility.";

const DEFAULT_KEYWORDS = [
  "ai agent monitoring", "monitor ai agents", "ai agent observability",
  "llm monitoring", "llm monitoring open source", "llm observability", "llm observability tool",
  "ai agent debugging", "ai agent performance monitoring", "ai agent cost tracking",
  "track llm api costs", "track token usage", "openai cost tracker", "reduce llm api costs",
  "why is my openai bill so high",
  "langchain monitoring", "langchain observability", "langchain agent failing silently",
  "langchain agent errors", "langchain agent debug",
  "crewai monitoring", "crewai observability", "crewai agent errors",
  "llamaindex monitoring", "llamaindex observability",
  "autogen monitoring", "openai agents monitoring", "claude code monitoring", "openclaw monitoring",
  "langsmith alternative", "langfuse alternative", "helicone alternative",
  "open source langsmith", "open source llm monitoring", "open source ai agent monitoring",
  "ai agent tracing", "llm tracing", "llm cost monitoring", "llm token usage tracker",
  "monitor llm token usage", "ai agent slow performance", "ai agent failures",
  "ai agent retry loop", "debug ai agent errors", "how to debug ai agent",
  "ai agent production monitoring", "ai agent real time monitoring",
  "monitor ai agent runs", "track ai agent runs",
  "ai agent metrics", "ai agent analytics", "ai agent dashboard",
  "llm api monitoring", "llm performance monitoring", "llm latency tracking",
  "ai agent latency", "ai agent cost per run", "llm cost per run",
  "openai token tracker", "anthropic api monitoring",
  "ai agent tool calls", "ai agent logs", "ai agent trace", "ai agent audit", "ai agent visibility",
  "full stack ai monitoring", "ai agent sdk", "open source ai sdk",
  "python ai agent monitoring", "javascript ai agent monitoring",
  "pip install agentmetrics", "npm agentmetrics",
  "ai agent observability platform", "observability for ai agents",
  "ai agent monitoring tool", "best ai agent monitoring tool",
  "ai agent monitoring free", "free llm monitoring", "free ai agent sdk",
].join(", ");

// Use the current deployment origin so canonical URLs and OG tags work
// correctly regardless of where users host their instance.
const BASE_URL = typeof window !== "undefined" ? window.location.origin : "";

function upsertMeta(selector, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
}

export default function Seo({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  keywords = DEFAULT_KEYWORDS,
  path = "/",
  robots = "noindex,nofollow",  // self-hosted dashboard should not be indexed
}) {
  useEffect(() => {
    const href = `${BASE_URL}${path}`;

    document.title = title;

    upsertMeta('meta[name="description"]',        { name: "description",        content: description });
    upsertMeta('meta[name="keywords"]',            { name: "keywords",            content: keywords });
    upsertMeta('meta[name="robots"]',              { name: "robots",              content: robots });
    upsertMeta('meta[property="og:title"]',        { property: "og:title",        content: title });
    upsertMeta('meta[property="og:description"]',  { property: "og:description",  content: DEFAULT_OG_DESCRIPTION });
    upsertMeta('meta[property="og:type"]',         { property: "og:type",         content: "website" });
    upsertMeta('meta[property="og:url"]',          { property: "og:url",          content: href });
    upsertMeta('meta[name="twitter:card"]',        { name: "twitter:card",        content: "summary_large_image" });
    upsertMeta('meta[name="twitter:title"]',       { name: "twitter:title",       content: title });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: DEFAULT_OG_DESCRIPTION });

    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", href);
  }, [description, keywords, path, robots, title]);

  return null;
}
