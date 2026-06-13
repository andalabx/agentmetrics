<p align="center">
  <img src="dashboard/public/favicon.svg" width="64" height="64" alt="AgentMetrics" />
</p>

<h1 align="center">AgentMetrics</h1>

<p align="center"><strong>Open-source observability for AI agents.</strong><br>
See cost, latency, token usage, and failures across every agent run, self-hosted with no account required.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6366f1" alt="License: MIT" /></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white" alt="Docker" /></a>
  <a href="packages/python/"><img src="https://img.shields.io/badge/python-3.9+-3776AB?logo=python&logoColor=white" alt="Python 3.9+" /></a>
  <a href="packages/js/"><img src="https://img.shields.io/badge/node-18+-339933?logo=node.js&logoColor=white" alt="Node 18+" /></a>
</p>

---

AgentMetrics is open-source observability for AI agents. One decorator in Python or one function call in JavaScript instruments any agent, and every run appears in your dashboard showing what agents are doing, how long it took, what it cost, how many tokens it used, which tools it called, and when it failed, all in real time.

Everything runs on your own machine or server and nothing ever leaves your infrastructure.

- **One decorator** in Python or one function call in JS, and any agent is instrumented in under a minute
- **SQLite by default**, works on your laptop with no database setup
- **Live dashboard on `:3099`**, REST API on `:8099`
- **Open the dashboard** and your data is already there, no login or credentials needed
- **Always running** — install as a system service so it survives reboots and crashes without Docker

---

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/andalabx/agentmetrics
cd agentmetrics
docker compose up
```

Dashboard → **http://localhost:3099**  
API docs → **http://localhost:8099/docs**

---

### Without Docker

Install the server package and start it in the foreground:

```bash
pip install agentmetrics-server
agentmetrics-server
```

To keep it running permanently so it survives reboots and crashes, install it as a system service instead:

```bash
agentmetrics install
```

That registers AgentMetrics with systemd on Linux, launchd on macOS, or Task Scheduler on Windows, starts it immediately, and makes it come back automatically after any restart.

---

## Always running

AgentMetrics is designed to run continuously, observing every agent across your laptop, VPS, and cloud environments. The `agentmetrics` CLI manages the server as an OS-level service with no Docker required.

```bash
agentmetrics install              # install and start — auto-restarts on crash, starts on boot
agentmetrics install --port 9000  # custom port
agentmetrics install --db postgresql://user:pass@localhost/mydb

agentmetrics start                # start a stopped service
agentmetrics stop                 # stop without uninstalling
agentmetrics restart              # restart
agentmetrics status               # show service state and HTTP health check
agentmetrics uninstall            # remove the service
```

On Linux, `agentmetrics install` creates a systemd service with `Restart=always` in your user slice (no sudo needed) or the system slice when run as root. On macOS it writes a launchd plist with `KeepAlive=true`. On Windows it registers a Task Scheduler task that runs at logon with highest privileges.

The database is stored in a persistent directory that survives updates and reinstalls — `~/.local/share/agentmetrics/` on Linux, `~/Library/Application Support/AgentMetrics/` on macOS, and `%APPDATA%\AgentMetrics\` on Windows.

### Docker users

When running with Docker Compose, `restart: unless-stopped` means the containers come back after any crash or reboot as long as the Docker daemon itself is running. On Linux, verify Docker starts on boot:

```bash
sudo systemctl enable docker
```

On macOS and Windows, Docker Desktop handles this through its own startup setting.

### Cloud deployments

Fly.io, Render, and Railway all manage process health and restarts automatically. The Fly.io config keeps one machine running at all times so events are never dropped between agent calls.

---

## Instrument your agents

Add one line to configure, wrap your agent function, and every run starts reporting.

### Python

```bash
pip install agentmetrics
```

```python
import agentmetrics

agentmetrics.configure(base_url="http://localhost:8099")

@agentmetrics.track(agent_id="my-agent")
def run(task: str) -> str:
    return call_llm(task)
```

Every call to `run()` reports to your dashboard showing duration, cost, token usage, tool calls, and when it failed.

### JavaScript / TypeScript

```bash
npm install agentmetrics
```

```typescript
import agentmetrics from "agentmetrics";

agentmetrics.configure({ baseUrl: "http://localhost:8099" });

const result = await agentmetrics.track("my-agent", async () => {
  return await callLLM(prompt);
});
```

Every invocation reports to your dashboard showing duration, cost, token usage, tool calls, and when it failed.

---

## Framework integrations

If you are using a framework like LangChain, CrewAI, or the OpenAI Agents SDK, drop in the matching integration instead, no decorator needed and token counts are captured automatically.

| Framework | Install |
|-----------|---------|
| **LangChain** (Python) | `pip install agentmetrics-langchain` |
| **LangChain** (JS) | `npm install agentmetrics-langchain` |
| **CrewAI** | `pip install agentmetrics-crewai` |
| **LlamaIndex** | `pip install agentmetrics-llamaindex` |
| **OpenAI Agents SDK** | `pip install agentmetrics-openai-agents` |
| **Anthropic** (Python) | `pip install agentmetrics-anthropic` |
| **Anthropic** (JS) | `npm install agentmetrics-anthropic` |
| **AutoGen** | `pip install agentmetrics-autogen` |
| **OpenClaw** | `openclaw plugins install agentmetrics-openclaw` |
| **Hermes** | `hermes plugins install agentmetrics-hermes` |

See [`packages/integrations/`](packages/integrations/) for setup guides.

---

## Dashboard

| View | What it shows |
|------|--------------|
| **Overview** | Health score, monthly cost, active alerts, daily briefing |
| **Agents** | Per-agent success rate, cost, latency |
| **Agent detail** | Hourly timeline, run history, cost breakdown |
| **Live** | Real-time agent activity, polling every 5 seconds |
| **Cost** | Cost breakdown by model, performance radar, optimization tips |
| **Alerts** | Configurable threshold rules and firing history |
| **Integrations** | SDK setup guide for all supported frameworks |

---

## Configuration

Copy `.env.example` to `.env` and edit as needed.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./data/agentmetrics.db` | SQLite (default) or `postgresql://…` |
| `FRONTEND_URL` | `http://localhost:3099` | Used for CORS allow-list |
| `ENVIRONMENT` | `production` | Set `development` to enable `/docs` |

### PostgreSQL

```bash
docker compose --profile postgres up
```

Or set `DATABASE_URL=postgresql://user:pass@host/db` in `.env`.

### Server flags

```bash
agentmetrics-server --port 9000
agentmetrics-server --db postgresql://user:pass@localhost/mydb
agentmetrics-server --open    # open the dashboard in a browser on startup
```

---

## Architecture

AgentMetrics is three components: your instrumented agents post events to the API over HTTP, the API stores them in SQLite or PostgreSQL, the dashboard reads from the API, and nothing ever leaves your network.

```
┌──────────────────────────────────────────────┐
│  Your agents  (Python / JS / any HTTP client) │
│  agentmetrics.track() ──► POST /v1/events     │
└────────────────────┬─────────────────────────┘
                     │
        ┌────────────▼──────────────┐
        │  API  :8099               │
        │  FastAPI + SQLAlchemy     │
        │  SQLite  (default)        │
        │  PostgreSQL  (optional)   │
        └────────────┬──────────────┘
                     │
        ┌────────────▼──────────────┐
        │  Dashboard  :3099         │
        │  Vite + React + nginx     │
        └───────────────────────────┘
```

---

## Local development

```bash
# API (hot reload)
cd api
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8099

# Dashboard (Vite HMR)
cd dashboard
npm install
npm run dev
# → http://localhost:3099
```

Or use the dev compose file:

```bash
docker compose -f docker-compose.dev.yml up
```

---

## Running in production

### Docker

1. Copy and edit the env file:
   ```bash
   cp .env.example .env
   # Set DATABASE_URL and FRONTEND_URL
   ```

2. Start:
   ```bash
   docker compose up -d
   ```

3. Reverse-proxy with nginx, Caddy, or Traefik as needed.

### Without Docker (VPS or bare metal)

Install the server and register it as a system service so it starts on boot and restarts on crash:

```bash
pip install agentmetrics-server
agentmetrics install --db postgresql://user:pass@localhost/mydb
```

Check that it came up:

```bash
agentmetrics status
```

### Deploy to a platform

| Platform | Config |
|----------|--------|
| Render | [`render.yaml`](render.yaml) |
| Fly.io | [`fly.toml`](fly.toml) |
| Railway | Connect the repo, set env vars |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs are welcome.

---

## License

[MIT](LICENSE)
