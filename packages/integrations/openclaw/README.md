# agentmetrics-openclaw

[![npm](https://img.shields.io/npm/v/agentmetrics-openclaw?color=6366f1&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/agentmetrics-openclaw)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../LICENSE)

AgentMetrics integration for [OpenClaw](https://openclaw.dev). Install the plugin, point it at your server, and every agent session reports back to your dashboard automatically showing tokens, cost, tools, subagents, context health, and reliability, all without changing your agent code.

---

## Requirements

- OpenClaw 2026.3.2 or later
- Node.js 22 or later
- A running AgentMetrics server (see the [main README](../../../README.md) for setup)

---

## Install

```bash
openclaw plugins install agentmetrics-openclaw
```

---

## Setup

**1. Start AgentMetrics** (if not already running)

```bash
# Docker
docker compose up

# Or Python CLI
pip install agentmetrics
agentmetrics dashboard
```

**2. Set the server URL** (if not running on localhost)

```bash
# macOS / Linux, permanent
echo 'export AGENTMETRICS_BASE_URL=http://your-server:8099' >> ~/.bashrc && source ~/.bashrc

# Windows (PowerShell)
$Env:AGENTMETRICS_BASE_URL = "http://your-server:8099"
```

Omit this step if your server runs on `http://localhost:8099` (the default).

**3. Trust the plugin** (silences the security scan advisory)

```bash
openclaw config set plugins.allow '["agentmetrics"]'
```

**4. Restart the gateway**

```bash
openclaw gateway restart
```

**5. Verify**

```bash
openclaw plugins list
# agentmetrics   loaded
```

**6. Set your agent name** (recommended)

In your agent's `openclaw.json`:

```json
{
  "name": "my-agent"
}
```

The `name` field becomes the agent ID in your dashboard. Give each agent a distinct name.

---

## What gets tracked

Every agent session reports automatically:

| Signal | Detail |
|---|---|
| **Cost** | Computed from token counts and model pricing |
| **Latency** | Wall-clock duration per run |
| **Tokens** | Input, output, cache read, cache write |
| **Tools** | Call count, errors, per-tool duration |
| **Subagents** | Spawned count, error count |
| **Context health** | Compaction count, reset count |
| **Reliability** | Success/failure, full error message |

---

## Troubleshooting

**"dangerous code patterns" warning on install**  
Safe to ignore. The plugin reads `AGENTMETRICS_BASE_URL` and makes network calls to the AgentMetrics API. Add `agentmetrics` to `plugins.allow` to suppress it permanently.

**"manifest id does not match package name" warning**  
Not an error. The plugin's internal manifest id is `agentmetrics`; the npm package name is `agentmetrics-openclaw`. Use `agentmetrics` (not the npm name) in `plugins.allow`.

**Runs not appearing in the dashboard**  
1. Verify the plugin loads: `openclaw plugins list`
2. Check the server is reachable: `openclaw agentmetrics test`
3. Restart the gateway after any env var change
4. Confirm your `openclaw.json` has a `name` field

---

## License

[MIT](../LICENSE)
