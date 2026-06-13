import React, { useState } from "react";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";

function CopyButton({ text, className = "" }) {
  const [state, setState] = useState("idle");
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  };
  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-t2 transition-colors hover:text-t1 ${className}`}
    >
      {state === "copied" ? (
        <>
          <svg className="h-3.5 w-3.5 text-savings" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function CodeBlock({ code }) {
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4 font-mono text-xs leading-7 text-t2">
        <code>{code}</code>
      </pre>
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function StepProgress({ current, total }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className="flex flex-1 gap-1">
        {[...Array(total)].map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i < current ? "bg-accent" : "bg-[var(--surface-2)]"}`}
          />
        ))}
      </div>
      <span className="shrink-0 text-[11px] text-t2">{current} of {total}</span>
    </div>
  );
}

function Step({ number, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-[var(--accent-bg)] text-xs font-bold text-accent">
        {number}
      </div>
      <div className="flex-1 pb-8">
        <p className="mt-0.5 text-sm font-semibold text-t1">{title}</p>
        <div className="mt-3 space-y-3">{children}</div>
      </div>
    </div>
  );
}

const PLATFORMS = [
  {
    id: "python",
    label: "Python",
    badge: "pip",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.914 0C5.82 0 6.2 2.656 6.2 2.656l.007 2.752h5.814v.826H3.9S0 5.789 0 11.969c0 6.18 3.403 5.96 3.403 5.96h2.03v-2.867s-.109-3.403 3.348-3.403h5.768s3.24.052 3.24-3.13V3.13S18.28 0 11.914 0zm-3.2 1.812a1.04 1.04 0 1 1 0 2.08 1.04 1.04 0 0 1 0-2.08zM12.086 24c6.094 0 5.714-2.656 5.714-2.656l-.007-2.752h-5.814v-.826h8.121S24 18.211 24 12.031c0-6.18-3.403-5.96-3.403-5.96h-2.03v2.867s.109 3.403-3.348 3.403h-5.768s-3.24-.052-3.24 3.13v5.399S5.72 24 12.086 24zm3.2-1.812a1.04 1.04 0 1 1 0-2.08 1.04 1.04 0 0 1 0 2.08z"/>
      </svg>
    ),
  },
  {
    id: "javascript",
    label: "JavaScript",
    badge: "npm",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873c-.736-.345-1.554-.585-1.797-1.14c-.091-.33-.105-.51-.046-.705c.15-.646.915-.84 1.515-.66c.39.12.75.42.976.9c1.034-.676 1.034-.676 1.755-1.125c-.27-.42-.404-.601-.586-.78c-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005c-1.14 1.291-.811 3.541.569 4.471c1.365 1.02 3.361 1.244 3.616 2.205c.24 1.17-.87 1.545-1.966 1.41c-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109c1.74 1.756 6.09 1.666 6.871-1.004c.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805c0 1.232.063 2.363-.138 2.711c-.33.689-1.18.601-1.566.48c-.396-.196-.597-.466-.83-.855c-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517c.855.51 2.004.675 3.207.405c.783-.226 1.458-.691 1.811-1.411c.51-.93.402-2.07.397-3.346c.012-2.054 0-4.109 0-6.179l.004-.056z"/>
      </svg>
    ),
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    badge: "no code",
    icon: <img src="/logos/openclaw.svg" className="h-4 w-4" alt="OpenClaw" />,
  },
  {
    id: "langchain",
    label: "LangChain",
    badge: "pip",
    icon: <img src="/logos/langchain-color.svg" className="h-4 w-4" alt="LangChain" />,
  },
  {
    id: "crewai",
    label: "CrewAI",
    badge: "pip",
    icon: <img src="/logos/crewai.svg" className="h-4 w-4" alt="CrewAI" />,
  },
  {
    id: "llamaindex",
    label: "LlamaIndex",
    badge: "pip",
    icon: <img src="/logos/llamaindex.svg" className="h-4 w-4" alt="LlamaIndex" />,
  },
  {
    id: "autogen",
    label: "AutoGen",
    badge: "pip",
    icon: <img src="/logos/autogen.svg" className="h-4 w-4 rounded-sm" alt="AutoGen" />,
  },
  {
    id: "openai-agents",
    label: "OpenAI Agents",
    badge: "pip",
    icon: <img src="/logos/openai.svg" className="h-4 w-4" alt="OpenAI Agents SDK" />,
  },
  {
    id: "anthropic-py",
    label: "Anthropic",
    badge: "pip",
    icon: <img src="/logos/anthropic.svg" className="h-4 w-4" alt="Anthropic" />,
  },
  {
    id: "anthropic-js",
    label: "Anthropic JS",
    badge: "npm",
    icon: <img src="/logos/anthropic.svg" className="h-4 w-4" alt="Anthropic" />,
  },
  {
    id: "hermes",
    label: "Hermes",
    badge: "plugin",
    icon: <img src="/logos/hermes.svg" className="h-4 w-4" alt="Hermes" />,
  },
];

function PythonContent() {
  const install   = `pip install agentmetrics`;
  const configure = `import agentmetrics

agentmetrics.configure(base_url="http://localhost:8099")`;
  const track     = `@agentmetrics.track(agent_id="my-agent")
def my_agent(task: str) -> str:
    # your agent logic here
    return result`;
  const advanced  = `# Auto-capture tokens from OpenAI / Anthropic
agentmetrics.instrument()

# Name individual steps for granular tracing
async def my_agent(task):
    result = await agentmetrics.step("plan", plan_task, task)
    answer = await agentmetrics.step("execute", execute_plan, result)
    return answer`;

  return (
    <div className="space-y-0">
      <StepProgress current={4} total={4} />
      <Step number={1} title="Install the SDK">
        <CodeBlock code={install} />
      </Step>
      <Step number={2} title="Configure with your server URL">
        <CodeBlock code={configure} />
        <p className="text-xs text-t2">Replace <code className="text-accent">http://localhost:8099</code> with your AgentMetrics server URL if it's running elsewhere.</p>
      </Step>
      <Step number={3} title="Wrap your agent function">
        <CodeBlock code={track} />
        <p className="text-xs text-t2">Every call to <code className="text-accent">my_agent()</code> is now tracked: duration, status, cost, and errors.</p>
      </Step>
      <Step number={4} title="Optional: auto-capture tokens and trace steps">
        <CodeBlock code={advanced} />
      </Step>
    </div>
  );
}

function JavaScriptContent() {
  const install   = `npm install agentmetrics`;
  const configure = `import agentmetrics from "agentmetrics";

// Call once at startup
agentmetrics.configure({ baseUrl: "http://localhost:8099" });
agentmetrics.instrument(); // auto-captures OpenAI + Anthropic tokens`;
  const track     = `const myAgent = agentmetrics.track("my-agent", async (task) => {
  // your agent logic here
  return result;
});

// Then call normally. All runs are tracked
await myAgent(task);`;
  const esm       = `// TypeScript / ESM fully supported
import agentmetrics, { type TrackOptions } from "agentmetrics";`;

  return (
    <div className="space-y-0">
      <StepProgress current={4} total={4} />
      <Step number={1} title="Install the SDK">
        <CodeBlock code={install} />
        <p className="text-xs text-t2">Requires Node.js ≥ 18. Works with TypeScript, ESM, and CommonJS.</p>
      </Step>
      <Step number={2} title="Configure and instrument">
        <CodeBlock code={configure} />
        <p className="text-xs text-t2"><code className="text-accent">instrument()</code> monkey-patches the OpenAI and Anthropic SDKs to auto-capture token usage. No changes to your LLM calls needed.</p>
      </Step>
      <Step number={3} title="Wrap your agent function">
        <CodeBlock code={track} />
      </Step>
      <Step number={4} title="TypeScript support">
        <CodeBlock code={esm} />
      </Step>
    </div>
  );
}

function OpenClawContent() {
  const install     = `openclaw plugins install agentmetrics-openclaw`;
  const restart     = `openclaw gateway restart`;
  const verify      = `openclaw plugins list\n# Look for: AgentMetrics | agentmetrics | loaded | 0.3.0`;
  const envTemp     = `export AGENTMETRICS_BASE_URL=http://localhost:8099`;
  const envPermanent = `echo 'export AGENTMETRICS_BASE_URL=http://localhost:8099' >> ~/.bashrc\nsource ~/.bashrc`;
  const allowCli    = `openclaw config set plugins.allow '["agentmetrics"]'`;
  const allowFallback = `# If the CLI command above is not supported, edit directly:\n# /home/<user>/.openclaw/openclaw.json\n{\n  "plugins": {\n    "allow": ["agentmetrics"]\n  }\n}`;
  const agentConfig = `// In your agent's openclaw.json\n{\n  "name": "my-agent"\n}`;
  const optionalConfig = `// In your agent's openclaw.json — all fields optional\n{\n  "name": "my-agent",\n  "agentmetrics": {\n    "redactionMode": "strict",\n    "toolNameExport": "blocklist",\n    "redactToolNames": [],\n    "flushIntervalSeconds": 10,\n    "retryMaxAttempts": 5\n  }\n}`;
  const cliStatus   = `openclaw agentmetrics status\n# Shows: endpoint, sessions tracked, runs in flight\n\nopenclaw agentmetrics test\n# Sends a test event and confirms end-to-end delivery\n\nopenclaw agentmetrics tail\n# Streams the last N real-time activity events\n\nopenclaw agentmetrics flush\n# Force-flush the event queue immediately`;

  return (
    <div className="space-y-0">
      <StepProgress current={5} total={5} />

      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-savings/25 bg-savings/[0.05] px-4 py-3">
        <svg className="h-4 w-4 shrink-0 text-savings" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
        </svg>
        <p className="text-sm text-savings font-medium">No code changes needed. The plugin hooks into every session automatically.</p>
      </div>

      <div className="mb-6 rounded-2xl border border-cost/25 bg-cost/[0.04] px-4 py-3">
        <p className="text-xs font-semibold text-cost">Upgrading from 0.2.x?</p>
        <p className="mt-1 text-xs text-t2">
          v0.3.0 removes the legacy hook path. If you previously installed <code className="text-accent">agentmetrics-openclaw</code> as both a plugin <em>and</em> a hook, remove the hook installation to avoid duplicate telemetry. Re-install the plugin only — no hook needed.
        </p>
      </div>

      <Step number={1} title="Install the plugin">
        <CodeBlock code={install} />
        <p className="text-xs text-t2">Requires OpenClaw ≥ 2026.3.2 and Node.js ≥ 22. This installs v0.3.0+.</p>
      </Step>

      <Step number={2} title="Restart the gateway">
        <CodeBlock code={restart} />
        <p className="text-xs text-t2">The plugin loads at gateway startup. A restart is required after install or update.</p>
      </Step>

      <Step number={3} title="Verify the plugin loaded">
        <CodeBlock code={verify} />
      </Step>

      <Step number={4} title="Set the server URL (permanent)">
        <CodeBlock code={envPermanent} />
        <p className="text-xs text-t2">Replace <code className="text-accent">http://localhost:8099</code> with your AgentMetrics server URL if it's running elsewhere. For a single session only, use:</p>
        <CodeBlock code={envTemp} />
        <p className="text-xs text-t2">The gateway must be restarted after setting the variable for the first time.</p>
      </Step>

      <Step number={5} title="Trust the plugin (silences install warnings)">
        <CodeBlock code={allowCli} />
        <p className="text-xs text-t2">
          Silences the <em>"plugins.allow is empty"</em> advisory and the <em>"dangerous code patterns"</em> scan. Run once; persists across updates.
        </p>
        <p className="text-xs text-t2 mt-2">If the CLI command isn't supported on your version, edit the file directly:</p>
        <CodeBlock code={allowFallback} />
      </Step>

      <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-t2">Agent name (recommended)</p>
        <p className="text-xs text-t2">The <code className="text-accent">name</code> field becomes the agent ID in your dashboard. Give each agent a distinct name if you run more than one.</p>
        <CodeBlock code={agentConfig} />
      </div>

      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-t2">Optional configuration</p>
        <p className="text-xs text-t2">
          All telemetry is <strong className="text-t1">redacted by default</strong> (strict mode). Tool names and error snippets are scrubbed before leaving your machine. To see full detail during development, set <code className="text-accent">redactionMode: "debug"</code> — it auto-expires after 1 hour.
        </p>
        <CodeBlock code={optionalConfig} />
      </div>

      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-t2">Observability CLI</p>
        <p className="text-xs text-t2">Use these commands to inspect the plugin's live state and verify delivery.</p>
        <CodeBlock code={cliStatus} />
      </div>

      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-t2">Expected install warnings</p>
        <div className="space-y-2">
          <div>
            <p className="text-xs font-medium text-t1">"dangerous code patterns: Environment variable access combined with network send"</p>
            <p className="text-xs text-t2 mt-0.5">Safe to ignore. OpenClaw flags any plugin that reads env vars and makes network calls. The plugin reads your server URL from <code className="text-accent">AGENTMETRICS_BASE_URL</code> and sends telemetry to it. This is expected behaviour.</p>
          </div>
          <div>
            <p className="text-xs font-medium text-t1">"Plugin manifest id 'agentmetrics' differs from npm package name 'agentmetrics-openclaw'"</p>
            <p className="text-xs text-t2 mt-0.5">Not an error. Use <code className="text-accent">agentmetrics</code> (the manifest id, not the npm name) in <code className="text-accent">plugins.allow</code>.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LangChainContent() {
  const install   = `pip install agentmetrics langchain`;
  const configure = `import agentmetrics
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor

agentmetrics.configure(base_url="http://localhost:8099")`;
  const track     = `@agentmetrics.track(agent_id="my-langchain-agent")
def run_agent(task: str) -> str:
    # Your LangChain chain or AgentExecutor call here
    return agent_executor.invoke({"input": task})["output"]`;
  const callback  = `# Auto-capture per-LLM-call tokens with the callback handler
from agentmetrics.integrations.langchain import AgentMetricsCallbackHandler

handler = AgentMetricsCallbackHandler()
llm = ChatOpenAI(callbacks=[handler])`;

  return (
    <div className="space-y-0">
      <StepProgress current={4} total={4} />
      <Step number={1} title="Install dependencies">
        <CodeBlock code={install} />
      </Step>
      <Step number={2} title="Configure AgentMetrics">
        <CodeBlock code={configure} />
      </Step>
      <Step number={3} title="Wrap your chain or agent">
        <CodeBlock code={track} />
        <p className="text-xs text-t2">The decorator tracks total duration, status, cost, and errors for every invocation of <code className="text-accent">run_agent()</code>.</p>
      </Step>
      <Step number={4} title="Optional: per-call token capture">
        <CodeBlock code={callback} />
        <p className="text-xs text-t2">The callback handler reports token counts for each individual LLM call inside the chain.</p>
      </Step>
    </div>
  );
}

function CrewAIContent() {
  const install   = `pip install agentmetrics crewai`;
  const configure = `import agentmetrics
from crewai import Agent, Task, Crew

agentmetrics.configure(base_url="http://localhost:8099")`;
  const track     = `@agentmetrics.track(agent_id="my-crew")
def run_crew(task_input: str) -> str:
    researcher = Agent(role="Researcher", goal="Find facts", backstory="...")
    task = Task(description=task_input, agent=researcher)
    crew = Crew(agents=[researcher], tasks=[task])
    return crew.kickoff()`;
  const multi     = `# Track multiple crews with distinct agent IDs
@agentmetrics.track(agent_id="research-crew")
def research(query): ...

@agentmetrics.track(agent_id="writing-crew")
def write(draft): ...`;

  return (
    <div className="space-y-0">
      <StepProgress current={4} total={4} />
      <Step number={1} title="Install dependencies">
        <CodeBlock code={install} />
      </Step>
      <Step number={2} title="Configure AgentMetrics">
        <CodeBlock code={configure} />
      </Step>
      <Step number={3} title="Wrap your crew kickoff">
        <CodeBlock code={track} />
        <p className="text-xs text-t2">Every <code className="text-accent">crew.kickoff()</code> is tracked as one run. Duration, status, cost, and errors are captured automatically.</p>
      </Step>
      <Step number={4} title="Tracking multiple crews">
        <CodeBlock code={multi} />
        <p className="text-xs text-t2">Give each crew a distinct <code className="text-accent">agent_id</code> to see them separately in your dashboard and compare performance.</p>
      </Step>
    </div>
  );
}

function LlamaIndexContent() {
  const install   = `pip install agentmetrics llama-index`;
  const configure = `import agentmetrics
from llama_index.core import Settings
from llama_index.core.callbacks import CallbackManager
from agentmetrics.integrations.llamaindex import AgentMetricsCallbackHandler

agentmetrics.configure(base_url="http://localhost:8099")

# Register globally — all LlamaIndex queries are tracked automatically
handler = AgentMetricsCallbackHandler(agent_id="my-llama-agent")
Settings.callback_manager = CallbackManager([handler])`;
  const query     = `from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

# No changes needed here. AgentMetrics captures every query automatically
documents = SimpleDirectoryReader("data").load_data()
index = VectorStoreIndex.from_documents(documents)
query_engine = index.as_query_engine()
response = query_engine.query("What are the key findings?")`;
  const decorator = `# Or use the decorator to track a specific function
@agentmetrics.track(agent_id="my-llama-agent")
def run_query(question: str) -> str:
    return str(query_engine.query(question))`;

  return (
    <div className="space-y-0">
      <StepProgress current={4} total={4} />
      <Step number={1} title="Install dependencies">
        <CodeBlock code={install} />
      </Step>
      <Step number={2} title="Register the callback handler">
        <CodeBlock code={configure} />
        <p className="text-xs text-t2">The callback handler hooks into LlamaIndex's global <code className="text-accent">Settings</code> and captures latency, token usage, and errors for every query and retrieval.</p>
      </Step>
      <Step number={3} title="Run your index queries normally">
        <CodeBlock code={query} />
        <p className="text-xs text-t2">No changes to your existing query code. Every call to <code className="text-accent">query_engine.query()</code> is tracked automatically.</p>
      </Step>
      <Step number={4} title="Or track a specific function">
        <CodeBlock code={decorator} />
      </Step>
    </div>
  );
}

function AutoGenContent() {
  const install   = `pip install agentmetrics-autogen`;
  const configure = `from agentmetrics_autogen import AgentMetricsRunStream

tracker = AgentMetricsRunStream(
    agent_id="my-autogen-team",
    base_url="http://localhost:8099",
)`;
  const run       = `# Wrap team.run_stream() — no other changes needed
async with tracker.run(team, task="Analyze this dataset") as stream:
    async for event in stream:
        pass  # handle events as normal

tracker.flush()`;
  const multi     = `# Give each team a distinct agent_id to compare in the dashboard
research_tracker = AgentMetricsRunStream(agent_id="research-team", base_url="http://localhost:8099")
writing_tracker  = AgentMetricsRunStream(agent_id="writing-team",  base_url="http://localhost:8099")`;

  return (
    <div className="space-y-0">
      <StepProgress current={3} total={3} />
      <Step number={1} title="Install the package">
        <CodeBlock code={install} />
      </Step>
      <Step number={2} title="Create a tracker">
        <CodeBlock code={configure} />
      </Step>
      <Step number={3} title="Wrap your team.run_stream() call">
        <CodeBlock code={run} />
        <p className="text-xs text-t2">
          Intercepts <code className="text-accent">ToolCallRequestEvent</code>, <code className="text-accent">ToolCallExecutionEvent</code>, and <code className="text-accent">TaskResult</code>. A run summary is emitted to AgentMetrics on context exit.
        </p>
      </Step>
      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-t2">Tracking multiple teams</p>
        <CodeBlock code={multi} />
      </div>
    </div>
  );
}

function OpenAIAgentsContent() {
  const install   = `pip install agentmetrics-openai-agents`;
  const configure = `from agents.tracing import add_trace_processor
from agentmetrics_openai_agents import AgentMetricsProcessor

# Register once at startup — covers all agents in the process
add_trace_processor(AgentMetricsProcessor(
    agent_id="my-openai-agent",
    base_url="http://localhost:8099",
))`;
  const run       = `from agents import Agent, Runner

my_agent = Agent(name="Research Agent", instructions="...")

# Run agents as normal — every trace is tracked automatically
result = await Runner.run(my_agent, "Summarize this document")`;

  return (
    <div className="space-y-0">
      <StepProgress current={3} total={3} />
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-savings/25 bg-savings/[0.05] px-4 py-3">
        <svg className="h-4 w-4 shrink-0 text-savings" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
        </svg>
        <p className="text-sm text-savings font-medium">No changes to your agents or Runner calls — registers as a tracing processor.</p>
      </div>
      <Step number={1} title="Install the package">
        <CodeBlock code={install} />
      </Step>
      <Step number={2} title="Register the processor once at startup">
        <CodeBlock code={configure} />
        <p className="text-xs text-t2">
          Implements <code className="text-accent">TracingProcessor</code> from <code className="text-accent">agents.tracing</code>. Call <code className="text-accent">add_trace_processor()</code> before running any agents.
        </p>
      </Step>
      <Step number={3} title="Run your agents as normal">
        <CodeBlock code={run} />
        <p className="text-xs text-t2">Every agent trace emits one event when <code className="text-accent">on_trace_end</code> fires — cost, latency, token usage, tool calls, and errors are aggregated automatically.</p>
      </Step>
    </div>
  );
}

function AnthropicPyContent() {
  const install   = `pip install agentmetrics-anthropic`;
  const configure = `import anthropic
from agentmetrics_anthropic import AgentMetricsSessionTracker

client  = anthropic.Anthropic()
tracker = AgentMetricsSessionTracker(
    agent_id="my-claude-agent",
    base_url="http://localhost:8099",
)`;
  const sync      = `# Sync — auto-tracked, no changes inside the loop
with tracker.stream(client, session_id="sess_...") as stream:
    for event in stream:
        pass  # handle events as normal

tracker.flush()`;
  const async_code = `# Async
async with tracker.astream(client, session_id="sess_...") as stream:
    async for event in stream:
        pass

await tracker.flush()`;

  return (
    <div className="space-y-0">
      <StepProgress current={3} total={3} />
      <Step number={1} title="Install the package">
        <CodeBlock code={install} />
      </Step>
      <Step number={2} title="Create a tracker">
        <CodeBlock code={configure} />
      </Step>
      <Step number={3} title="Stream your session">
        <CodeBlock code={sync} />
        <p className="text-xs text-t2">A run summary is emitted automatically when <code className="text-accent">session.status_terminated</code> is received. Async usage:</p>
        <CodeBlock code={async_code} />
      </Step>
    </div>
  );
}

function AnthropicJsContent() {
  const install   = `npm install agentmetrics-anthropic`;
  const configure = `import Anthropic from "@anthropic-ai/sdk";
import { AgentMetricsSessionTracker } from "agentmetrics-anthropic";

const client  = new Anthropic();
const tracker = new AgentMetricsSessionTracker({
  agentId: "my-claude-agent",
  baseUrl: "http://localhost:8099",
});`;
  const wrap      = `// Wrap an existing event stream
const rawStream = client.beta.sessions.events.stream("sess_...");
const tracked   = tracker.wrap(rawStream, "sess_...");

for await (const event of tracked) {
  // events pass through unchanged — metrics emitted on session end
}`;
  const helper    = `// Or use the higher-level track() helper
await tracker.track(client, "sess_...", async (stream) => {
  for await (const event of stream) {
    // handle events
  }
});`;

  return (
    <div className="space-y-0">
      <StepProgress current={3} total={3} />
      <Step number={1} title="Install the package">
        <CodeBlock code={install} />
      </Step>
      <Step number={2} title="Create a tracker and wrap your session stream">
        <CodeBlock code={configure} />
        <CodeBlock code={wrap} />
      </Step>
      <Step number={3} title="Or use the track() helper">
        <CodeBlock code={helper} />
        <p className="text-xs text-t2">Opens the session stream, wraps it with tracking, and emits a run summary on completion or error. All session events pass through unchanged.</p>
      </Step>
    </div>
  );
}

function HermesContent() {
  const install   = `hermes plugins install agentmetrics-hermes`;
  const config_ts = `import agentmetrics from "agentmetrics-hermes";

export default {
  plugins: [agentmetrics],
  metrics: {
    endpoint: "http://localhost:8099",
  },
};`;
  const config_env = `export AGENTMETRICS_URL=http://localhost:8099`;
  const cli        = `hermes agentmetrics status   # config, counters, circuit breaker state
hermes agentmetrics test     # send a test event and confirm delivery
hermes agentmetrics tail     # stream in-flight run state
hermes agentmetrics flush    # force-flush the event queue
hermes agentmetrics drain    # retry all dead-letter queue events`;

  return (
    <div className="space-y-0">
      <StepProgress current={3} total={3} />
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-savings/25 bg-savings/[0.05] px-4 py-3">
        <svg className="h-4 w-4 shrink-0 text-savings" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
        </svg>
        <p className="text-sm text-savings font-medium">No code changes — the plugin hooks into every session and run automatically.</p>
      </div>
      <Step number={1} title="Install the plugin">
        <CodeBlock code={install} />
        <p className="text-xs text-t2">Requires Hermes ≥ 0.5 and Node.js ≥ 22. The plugin registers itself and starts tracking immediately after the next gateway restart.</p>
      </Step>
      <Step number={2} title="Configure in hermes.config.ts">
        <CodeBlock code={config_ts} />
        <p className="text-xs text-t2">Or skip the config file entirely and set an environment variable — no config needed:</p>
        <CodeBlock code={config_env} />
        <p className="text-xs text-t2">Replace <code className="text-accent">http://localhost:8099</code> with your AgentMetrics server URL if it's running elsewhere.</p>
      </Step>
      <Step number={3} title="Verify with the CLI">
        <CodeBlock code={cli} />
        <p className="text-xs text-t2">All commands run inside the Hermes gateway process and report live state without a restart.</p>
      </Step>
    </div>
  );
}

export default function IntegrationsPage() {
  const [platform, setPlatform] = useState("python");

  return (
    <AppLayout>
      <Seo
        title="Integrations | AgentMetrics"
        description="Connect your AI agents to AgentMetrics with Python, JavaScript, or OpenClaw."
        path="/connect"
        app
        robots="noindex,nofollow"
      />

      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">

        <section className="rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card sm:p-7">
          <h1 className="text-3xl font-bold tracking-tight text-t1 sm:text-4xl">
            Connect your agents
          </h1>
          <p className="mt-2 text-sm leading-7 text-t2">
            Choose your platform. You'll have full observability running in under 5 minutes.
          </p>
        </section>

        <section className="rounded-[28px] border border-[var(--border)] bg-surface shadow-card">

          <div className="overflow-x-auto border-b border-[var(--border)]">
            <div className="flex min-w-max items-center gap-1 p-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${
                    platform === p.id
                      ? "bg-[var(--accent-bg)] text-accent"
                      : "text-t2 hover:bg-[var(--surface-2)] hover:text-t1"
                  }`}
                >
                  {p.icon}
                  {p.label}
                  <span className={`hidden rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline ${
                    platform === p.id ? "bg-accent/20 text-accent" : "bg-[var(--surface-2)] text-t2"
                  }`}>
                    {p.badge}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="p-6 sm:p-8">
            {platform === "python"        && <PythonContent />}
            {platform === "javascript"    && <JavaScriptContent />}
            {platform === "openclaw"      && <OpenClawContent />}
            {platform === "langchain"     && <LangChainContent />}
            {platform === "crewai"        && <CrewAIContent />}
            {platform === "llamaindex"    && <LlamaIndexContent />}
            {platform === "autogen"       && <AutoGenContent />}
            {platform === "openai-agents" && <OpenAIAgentsContent />}
            {platform === "anthropic-py"  && <AnthropicPyContent />}
            {platform === "anthropic-js"  && <AnthropicJsContent />}
            {platform === "hermes"        && <HermesContent />}
          </div>
        </section>

        <section className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card sm:p-6">
          <p className="text-xs uppercase tracking-[0.18em] text-t2">After setup</p>
          <h2 className="mt-2 text-lg font-bold tracking-tight text-t1">What to expect</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { title: "First event within seconds", desc: "Run your agent once. It appears in the Agents page immediately." },
              { title: "Analytics after a few runs", desc: "Latency percentiles, failure patterns, and cost trends build up automatically." },
              { title: "Recommendations kick in", desc: "Optimization suggestions based on your actual run data appear once there's enough signal." },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <p className="text-sm font-semibold text-t1">{title}</p>
                <p className="mt-1 text-xs leading-6 text-t2">{desc}</p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </AppLayout>
  );
}
