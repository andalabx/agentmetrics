# agentmetrics-server

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-server?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-server)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../LICENSE)

Self-hosted AgentMetrics API server. Install it once and every agent instrumented with the AgentMetrics SDK reports to your own dashboard showing cost, latency, token usage, tool calls, and failures, with no cloud account and no data leaving your infrastructure.

---

## Install

```bash
pip install agentmetrics-server
```

Requires Python 3.11 or later.

---

## Quickstart

Start the server in the foreground:

```bash
agentmetrics-server
```

Dashboard → **http://localhost:3099**  
API → **http://localhost:8099**

Data is stored in `agentmetrics.db` in the current directory by default.

---

## Always running

For continuous 24/7 observation across reboots and crashes, install as a system service instead of running in the foreground:

```bash
agentmetrics install
```

This registers the server with systemd on Linux, launchd on macOS, or Task Scheduler on Windows, starts it immediately, and configures it to come back automatically after any restart or crash. The database is stored in a persistent OS data directory so it is never lost across reinstalls.

```bash
agentmetrics install              # install and start with defaults
agentmetrics install --port 9000  # custom port
agentmetrics install --db postgresql://user:pass@localhost/mydb

agentmetrics start                # start a stopped service
agentmetrics stop                 # stop without uninstalling
agentmetrics restart              # restart
agentmetrics status               # show service state and HTTP health check
agentmetrics uninstall            # remove the service
```

### Platform behaviour

| Platform | Mechanism | Restarts on crash | Starts on boot |
|---|---|---|---|
| Linux (non-root) | systemd user service | yes | yes |
| Linux (root) | systemd system service | yes | yes |
| macOS | launchd user agent | yes | yes |
| Windows | Task Scheduler (ONLOGON) | no | yes (at logon) |

On Linux, the service unit is written to `~/.config/systemd/user/agentmetrics.service` when run as a normal user, or `/etc/systemd/system/agentmetrics.service` when run as root. Logs are available via `journalctl --user -u agentmetrics -f`.

On macOS, the plist is written to `~/Library/LaunchAgents/com.agentmetrics.server.plist` and logs go to `~/Library/Logs/AgentMetrics/`.

---

## Configuration

All options can be passed as flags or set via environment variables.

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--port` | `PORT` | `8099` | Port to bind |
| `--host` | — | `0.0.0.0` | Host to bind |
| `--db` | `DATABASE_URL` | `sqlite:///./agentmetrics.db` | Database URL |
| `--open` | — | off | Open browser on startup |

### SQLite (default)

No setup needed. The database is created automatically in the current directory, or in the OS data directory when running as a service.

### PostgreSQL

```bash
pip install "agentmetrics-server[postgres]"
agentmetrics-server --db postgresql://user:pass@localhost/agentmetrics
```

Or as a persistent service:

```bash
agentmetrics install --db postgresql://user:pass@localhost/agentmetrics
```

---

## Foreground options

```bash
agentmetrics-server --port 9000
agentmetrics-server --host 127.0.0.1     # localhost only
agentmetrics-server --db postgresql://user:pass@localhost/mydb
agentmetrics-server --open               # open dashboard in browser on start
```

---

## Health check

```
GET /health  →  {"status": "ok"}
```

---

## License

[MIT](../LICENSE)
