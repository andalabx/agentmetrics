export const POSTS = [
  {
    slug: "why-your-langchain-agent-is-silently-failing",
    title: "Why your LangChain agent is silently failing",
    date: "May 15, 2026",
    excerpt:
      "LangChain agents swallow errors in ways that are easy to miss. A tool call returns an error string instead of raising, a retry loop exhausts its budget silently, or an LLM returns a malformed action that the framework paper-clips over. Your agent keeps running, reports success, and delivers the wrong answer. Here's how to find these failures before your users do.",
    tag: "Engineering",
  },
  {
    slug: "how-to-reduce-openai-api-costs-by-60-percent",
    title: "How to reduce OpenAI API costs by 60% without changing your agent logic",
    date: "May 8, 2026",
    excerpt:
      "Most agent cost spikes are caused by three things: runaway retry loops, over-padded system prompts, and the wrong model for the task. None of these require you to change your agent's behavior or goals. We analyzed 50,000 agent runs and found that the average agent is paying for 3x more tokens than it needs to. This is how we got it down.",
    tag: "Cost Optimization",
  },
  {
    slug: "agentmetrics-vs-langsmith",
    title: "AgentMetrics vs LangSmith: What's different and when each makes sense",
    date: "May 12, 2026",
    excerpt:
      "LangSmith is a natural fit if your entire stack is LangChain. But if you're running OpenClaw, Hermes, CrewAI, or custom agents, you'll be writing manual tracing calls and paying for features you don't use. Here's an honest breakdown of where each tool fits.",
    tag: "Comparison",
  },
  {
    slug: "agentmetrics-vs-langfuse",
    title: "AgentMetrics vs LangFuse: Two open source options compared",
    date: "May 10, 2026",
    excerpt:
      "LangFuse is open source and self-hostable, which makes it popular with teams who want full data control. It's built around tracing LLM calls and evaluation workflows. AgentMetrics is also open source, but its data model is built around agent runs, not completions. Here's how the two compare in practice.",
    tag: "Comparison",
  },
  {
    slug: "agentmetrics-vs-helicone",
    title: "AgentMetrics vs Helicone: Agent monitoring vs API proxy",
    date: "May 6, 2026",
    excerpt:
      "Helicone sits between your code and the OpenAI API and captures every request. That works well for raw LLM call monitoring. But a proxy sees individual completions, not the agent loop they're part of. If you need to understand why an agent failed, not just which API call was expensive, you need a different tool.",
    tag: "Comparison",
  },
  {
    slug: "agentmetrics-v01-observability-for-the-agentic-era",
    title: "AgentMetrics v0.1: Observability for the agentic era",
    date: "May 1, 2026",
    excerpt:
      "Today we're launching the public beta of AgentMetrics. The SDK is MIT-licensed and open source. The cloud product is free to start. Here's what we built, why we built it, and what's coming next for teams running AI agents in production.",
    tag: "Announcement",
  },
];
