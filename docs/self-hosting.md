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
║  Dashboard → http://localhost:3099       ║
╚══════════════════════════════════════════╝
```

Open the dashboard at `http://localhost:3099`, paste the key, and you're done.

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

# Dashboard URL (used for CORS allowlist)
FRONTEND_URL=http://localhost:3099

# Public URLs reported in logs and first-run output
APP_URL=http://localhost:3099
API_URL=http://localhost:8099

# Bind address — 127.0.0.1 for local, 0.0.0.0 behind a reverse proxy
bind_host=0.0.0.0
```

## Running as a System Service

### Linux (systemd)

```bash
agentmetrics install
sudo systemctl enable --now agentmetrics
```

The service file is written to `/etc/systemd/system/agentmetrics.service`.

### macOS (launchd)

```bash
agentmetrics install
launchctl load ~/Library/LaunchAgents/com.andalabx.agentmetrics.plist
```

### Windows (Task Scheduler / NSSM)

```bash
agentmetrics install
```

The service is registered via NSSM. The startup script is written to `%APPDATA%\agentmetrics\start.bat` with permissions restricted to the current user.

## Rotating the API Key

```bash
curl -X POST http://localhost:8099/v1/auth/rotate-key \
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

Events are stored until you delete them. There is no automatic expiry by default.

## Backup

### SQLite

```bash
# Copy the database file while the server is stopped, or use SQLite's online backup:
sqlite3 ~/.local/share/agentmetrics/agentmetrics.db ".backup '/path/to/backup.db'"

# With Docker:
docker run --rm -v agentmetrics_api_data:/data alpine \
  sh -c "cp /data/agentmetrics.db /data/agentmetrics.db.bak"
```

### PostgreSQL

```bash
# Standard pg_dump (can run while the server is up):
pg_dump -U agentmetrics agentmetrics > backup.sql

# With Docker Compose:
docker compose exec postgres pg_dump -U agentmetrics agentmetrics > backup.sql

# Restore:
psql -U agentmetrics agentmetrics < backup.sql
```

Schedule these commands with cron or your platform's task scheduler to run daily.

## Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name metrics.example.com;

    # API
    location /v1/ {
        proxy_pass http://127.0.0.1:8099;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Dashboard
    location / {
        proxy_pass http://127.0.0.1:3099;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Security Checklist

- [ ] Change the default PostgreSQL password in `.env`
- [ ] Bind to `127.0.0.1` (not `0.0.0.0`) unless behind a reverse proxy
- [ ] Enable TLS on your reverse proxy
- [ ] Restrict firewall access to ports 8099 (API) and 3099 (dashboard)
- [ ] Rotate the API key after any suspected compromise (`agentmetrics rotate-key`)
- [ ] Review WAL file permissions (see below)

## WAL File Security (Hermes / OpenClaw)

The Hermes and OpenClaw plugins write a local write-ahead log (WAL) to disk so that events are not lost if your process exits before they can be flushed to the API. The WAL directory is created with mode `0700` (owner-read/write only), but the files themselves are plaintext JSON — they may contain agent IDs, tool names, and metadata.

**Default paths:**

- Hermes: `~/.config/hermes/agentmetrics-wal.jsonl`
- OpenClaw: `~/.config/openclaw/agentmetrics-wal.jsonl`

**Recommendations:**

- Run agents under a dedicated service account, not your personal user.
- On Linux you can verify permissions: `ls -la ~/.config/hermes/`
- If your threat model requires confidentiality at rest, place the WAL directory on an encrypted filesystem or volume.
- WAL files are automatically pruned after events are delivered; entries do not accumulate indefinitely.

## Troubleshooting

**"Could not reach the AgentMetrics API"** — The server is not running or the URL is wrong. Check `agentmetrics start` or `docker compose logs api`.

**"Invalid API key"** — The key printed on first run has expired or was mistyped. Run `agentmetrics rotate-key` to generate a new one.

**Dashboard shows no data** — Confirm your SDK is pointing at the right server URL and using the correct API key. Check the agent-side logs for `[agentmetrics]` lines.
