# Self-Hosting AgentMetrics

AgentMetrics is a single-tenant, self-hosted observability tool for AI agents. There is no cloud service, no signup, and no data leaves your infrastructure.

## Requirements

- Python 3.9+ **or** Docker
- 512 MB RAM (PostgreSQL mode: 1 GB+)
- A server or VM reachable from wherever your agents run

## Quick Start (SQLite, single machine)

```bash
pip install agentmetrics
agentmetrics start
```

On first run, the server prints a one-time API key to stderr:

```
╔══════════════════════════════════════════╗
║        AgentMetrics — API Key            ║
║                                          ║
║  am_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx     ║
║                                          ║
║  Shown once. Store it somewhere safe.   ║
║  Dashboard → http://localhost:4000       ║
╚══════════════════════════════════════════╝
```

Open the dashboard at `http://localhost:4000`, paste the key, and you're done.

The database is stored at `~/.local/share/agentmetrics/agentmetrics.db` (Linux/macOS) or `%APPDATA%\agentmetrics\agentmetrics.db` (Windows).

## Docker Compose (Recommended for Production)

```bash
git clone https://github.com/andalabx/agentmetrics
cd agentmetrics
docker compose up -d
```

The API key is printed to the `api` container's stderr on first start:

```bash
docker compose logs api | grep "am_"
```

### Configuration

Copy `.env.example` to `.env` and edit:

```env
# PostgreSQL (used by docker compose automatically)
DATABASE_URL=postgresql://agentmetrics:changeme@db:5432/agentmetrics

# Bind address — 127.0.0.1 for local, 0.0.0.0 behind a reverse proxy
BIND_HOST=127.0.0.1
BIND_PORT=4000

# CORS origins for the dashboard
ALLOWED_ORIGINS=http://localhost:4000
```

## Running as a System Service

### Linux (systemd)

```bash
agentmetrics install-service
sudo systemctl enable --now agentmetrics
```

The service file is written to `/etc/systemd/system/agentmetrics.service`. Credentials are stored in `/etc/agentmetrics/server.env` (mode 600).

### macOS (launchd)

```bash
agentmetrics install-service
launchctl load ~/Library/LaunchAgents/com.andalabx.agentmetrics.plist
```

### Windows (Task Scheduler / NSSM)

```bash
agentmetrics install-service
```

The service is registered via NSSM. The startup script is written to `%APPDATA%\agentmetrics\start.bat` with permissions restricted to the current user.

## Rotating the API Key

```bash
# CLI
agentmetrics rotate-key

# API
curl -X POST http://localhost:4000/v1/auth/rotate-key \
  -H "Authorization: Bearer am_old_key"
```

The response contains the new raw key. Update all SDK configurations with the new key.

## Upgrading

```bash
pip install --upgrade agentmetrics
agentmetrics migrate   # runs Alembic migrations
agentmetrics start
```

With Docker:

```bash
docker compose pull
docker compose up -d
```

Alembic migrations run automatically on startup.

## Data Retention

The default retention policy keeps events for **90 days**. To change it:

```env
RETENTION_DAYS=180
```

Set to `0` to disable automatic deletion.

## Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name metrics.example.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Security Checklist

- [ ] Change the default PostgreSQL password in `.env`
- [ ] Bind to `127.0.0.1` (not `0.0.0.0`) unless behind a reverse proxy
- [ ] Enable TLS on your reverse proxy
- [ ] Restrict firewall access to port 4000
- [ ] Rotate the API key after any suspected compromise (`agentmetrics rotate-key`)

## Troubleshooting

**"Could not reach the AgentMetrics API"** — The server is not running or the URL is wrong. Check `agentmetrics start` or `docker compose logs api`.

**"Invalid API key"** — The key printed on first run has expired or was mistyped. Run `agentmetrics rotate-key` to generate a new one.

**Dashboard shows no data** — Confirm your SDK is pointing at the right server URL and using the correct API key. Check the agent-side logs for `[agentmetrics]` lines.
