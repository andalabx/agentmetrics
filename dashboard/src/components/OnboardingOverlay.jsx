import { useState, useEffect, useRef } from "react";
import { getAgents } from "../api/agents";

function CopyButton({ text, label = "Copy", copiedLabel = "Copied" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
        copied
          ? "border-accent/40 bg-[var(--accent-bg)] text-accent"
          : "border-[var(--border)] bg-[var(--surface-2)] text-t2 hover:text-t1"
      }`}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

function CodeBlock({ code, language }) {
  return (
    <div className="relative rounded-2xl border border-[var(--border)] bg-[#050C0A] p-4">
      {language && (
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-t3">{language}</p>
      )}
      <pre className="overflow-x-auto font-mono text-xs leading-6 text-accent whitespace-pre-wrap break-all sm:break-normal sm:whitespace-pre">{code}</pre>
      <div className="absolute right-3 top-3">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

const FRAMEWORKS = [
  { id: "python",    label: "Python",     desc: "Custom agent or script",         icon: "🐍" },
  { id: "node",      label: "Node.js",    desc: "JavaScript / TypeScript agent",   icon: "⬡" },
  { id: "langchain", label: "LangChain",  desc: "LangChain chains or agents",      icon: "🔗" },
  { id: "crewai",    label: "CrewAI",     desc: "CrewAI multi-agent crews",        icon: "🤝" },
  { id: "llamaindex",label: "LlamaIndex", desc: "LlamaIndex query engines",        icon: "🦙" },
  { id: "openclaw",  label: "OpenClaw",   desc: "No code changes needed",          icon: "🔌" },
  { id: "hermes",    label: "Hermes",     desc: "Hermes agent runtime",            icon: "⚡" },
];

function getInstructions(framework) {
  switch (framework) {
    case "python":
      return [
        { label: "1. Install", code: "pip install agentmetrics" },
        { label: "2. Configure & track", code: `import agentmetrics
agentmetrics.configure(base_url="http://localhost:8099")

@agentmetrics.track(agent_id="my_agent")
def my_agent(task):
    # your agent logic
    return result` },
      ];
    case "node":
      return [
        { label: "1. Install", code: "npm install agentmetrics" },
        { label: "2. Configure & track", code: `import agentmetrics from "agentmetrics";
agentmetrics.configure({ baseUrl: "http://localhost:8099" });

const result = await agentmetrics.track("my_agent", async () => {
  // your agent logic
});` },
      ];
    case "langchain":
      return [
        { label: "1. Install", code: "pip install agentmetrics" },
        { label: "2. Configure & track", code: `import agentmetrics
agentmetrics.configure(base_url="http://localhost:8099")

@agentmetrics.track(agent_id="my_agent")
def run_chain(input):
    return my_chain.invoke(input)` },
      ];
    case "crewai":
      return [
        { label: "1. Install", code: "pip install agentmetrics" },
        { label: "2. Configure & track", code: `import agentmetrics
agentmetrics.configure(base_url="http://localhost:8099")

@agentmetrics.track(agent_id="my_crew")
def run_crew(input):
    return crew.kickoff(inputs=input)` },
      ];
    case "llamaindex":
      return [
        { label: "1. Install", code: "pip install agentmetrics" },
        { label: "2. Configure & track", code: `import agentmetrics
agentmetrics.configure(base_url="http://localhost:8099")

@agentmetrics.track(agent_id="my_agent")
def query(input):
    return query_engine.query(input)` },
      ];
    case "openclaw":
      return [
        { label: "1. Install plugin", code: "openclaw plugins install agentmetrics-openclaw" },
        { label: "2. Set server URL", code: `# In your shell or OpenClaw config
export AGENTMETRICS_BASE_URL=http://localhost:8099

# No other code changes. Every session is tracked automatically.` },
      ];
    case "hermes":
      return [
        { label: "1. Install plugin", code: "pip install agentmetrics-hermes" },
        { label: "2. Set server URL", code: `# In your shell or Hermes config
export AGENTMETRICS_BASE_URL=http://localhost:8099

# AgentMetrics auto-attaches to every Hermes run.` },
      ];
    default:
      return [{ label: "Install", code: "pip install agentmetrics" }];
  }
}

export default function OnboardingOverlay({ onDismiss }) {
  const [step, setStep] = useState(0);
  const [framework, setFramework] = useState(null);
  const [connected, setConnected] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const pollRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (step !== 2) return;
    setPollTimedOut(false);
    pollRef.current = setInterval(async () => {
      try {
        const res = await getAgents();
        if (res.data?.length > 0) {
          setConnected(true);
          clearInterval(pollRef.current);
          clearTimeout(timeoutRef.current);
        }
      } catch {}
    }, 3000);
    timeoutRef.current = setTimeout(() => {
      clearInterval(pollRef.current);
      setPollTimedOut(true);
    }, 5 * 60 * 1000);
    return () => {
      clearInterval(pollRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, [step]);

  const instructions = framework ? getInstructions(framework) : [];
  const TOTAL_STEPS = 3;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm px-4 pb-4 sm:items-center sm:pb-0">
      <div className="glass-panel fade-in-up w-full max-w-lg rounded-[32px] px-7 py-8 space-y-6 max-h-[90vh] overflow-y-auto">

        <div className="flex items-center gap-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === step ? "w-10 bg-accent" : i < step ? "w-5 bg-accent/40" : "w-5 bg-[var(--border)]"
              }`}
            />
          ))}
          <button onClick={onDismiss} className="ml-auto text-xs text-t3 transition-colors hover:text-t2">
            Skip for now
          </button>
        </div>

        {/* Step 1: Framework picker */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Step 1 of {TOTAL_STEPS}</p>
              <h2 className="text-2xl font-bold tracking-tight text-t1">Where is your agent?</h2>
              <p className="mt-2 text-sm text-t2">Pick your framework and we'll show you exactly what to add.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {FRAMEWORKS.map((fw) => (
                <button
                  key={fw.id}
                  onClick={() => setFramework(fw.id)}
                  className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                    framework === fw.id
                      ? "border-accent bg-accent/10"
                      : "border-[var(--border)] bg-[var(--surface-2)] hover:border-accent/40"
                  }`}
                >
                  <span className="text-xl leading-none mt-0.5">{fw.icon}</span>
                  <div>
                    <p className={`text-sm font-semibold ${framework === fw.id ? "text-accent" : "text-t1"}`}>{fw.label}</p>
                    <p className="text-[11px] text-t2 leading-4 mt-0.5">{fw.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep(1)}
              disabled={!framework}
              className="w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Next: install
            </button>
          </div>
        )}

        {/* Step 2: Install */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Step 2 of {TOTAL_STEPS}</p>
              <h2 className="text-2xl font-bold tracking-tight text-t1">
                Instrument your agent
              </h2>
              <p className="mt-2 text-sm text-t2">
                {framework === "openclaw" || framework === "hermes"
                  ? "Plugin-based. Zero code changes required."
                  : "Copy and run these two steps."}
              </p>
            </div>

            <div className="space-y-3">
              {instructions.map((block) => (
                <CodeBlock key={block.label} code={block.code} language={block.label} />
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep(0)}
                className="rounded-2xl border border-[var(--border)] px-5 py-3 text-sm font-medium text-t2 transition-colors hover:text-t1"
              >
                Back
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90"
              >
                Next: verify connection
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Waiting for first run */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Step 3 of {TOTAL_STEPS}</p>
              <h2 className="text-2xl font-bold tracking-tight text-t1">
                {connected ? "Agent connected!" : pollTimedOut ? "No agent detected" : "Waiting for your first run..."}
              </h2>
              <p className="mt-2 text-sm text-t2">
                {connected
                  ? "Your dashboard is now live. AgentMetrics is tracking your agent."
                  : pollTimedOut
                  ? "Make sure your server URL is correct and your agent ran at least once."
                  : "Run your agent once with the SDK configured. We detect it automatically."}
              </p>
            </div>

            {connected ? (
              <div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                </div>
                <p className="text-sm font-semibold text-accent">First agent run detected</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3.5">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
                </span>
                <p className="text-sm text-t2">Listening for events. Run your agent now.</p>
              </div>
            )}

            <button
              onClick={onDismiss}
              className="w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90"
            >
              {connected ? "View my dashboard" : "Go to dashboard"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
