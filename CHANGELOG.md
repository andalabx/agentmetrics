# Changelog

All notable changes to AgentMetrics are documented here.

---

## June 20, 2026 — v0.2.0: Shared pricing, infra metrics, Hermes Python rewrite

### New packages
- **`agentmetrics-shared` (Python) / `@agentmetrics/core` (TypeScript)** — Shared pricing table, event schemas, and redaction logic extracted into standalone packages. All integrations now depend on these instead of maintaining inline pricing.
- **`agentmetrics-hermes` (Python)** — Hermes integration rewritten from TypeScript to Python. Full feature parity with the npm plugin: WAL-backed delivery, circuit breaker, DLQ, PII redaction, batch queuing, and infrastructure metrics.

### New features
- **Infrastructure metrics endpoint** (`POST /v1/infra/metrics`) — Ingest CPU, memory, disk, and network metrics per host. Correlate with agent runs via `host_id`. New `InfraMetric` DB model and `/v1/infra/correlation` endpoint.
- **Audit event pipeline counters** — `audit_wal_recovery`, `audit_access_denied`, and `audit_dlq_alert` events are auto-tracked into `metrics_hourly` pipeline health counters (`wal_recovered_count`, `access_denied_count`, `dlq_alert_count`, `duplicate_count`).
- **Runtime model registry** — `register_prices()` (Python) and `registerModelPrices()` / `_registerModelPrices()` (TypeScript) allow plugins and framework integrations to inject custom model pricing at startup with priority over the static table.
- **Platform filter** — Agent list and run list endpoints now accept `?platform=` query param.
- **Dashboard platform details** — `RunDetailPage` shows platform-specific metadata per run (Hermes skills/memory/secrets, LangChain chain steps, CrewAI crew name, Anthropic session ID).

### New event schema fields
- Dimension tagging: `host_id`, `workflow_id`, `skill_name`, `toolset`
- Security audit: `secrets_blocked_count`, `pii_detected_count`

### Security
- Fixed latent SQL injection in `_increment_pipeline_counter` — added `_ALLOWED_COUNTER_COLS` allowlist.
- Added 64 KB size cap on `custom` field in infra metrics batch endpoint.
- Bounded token fields (`input_tokens`, `output_tokens`, etc.) to `int` with `ge=0, le=10_000_000`.
- Added `max_length` to 8 previously unbounded string fields in `EventCreate`.
- Added `le` bounds to all integer counter fields (`step_count`, `loop_count`, `llm_calls`, etc.).
- Added prototype-pollution guard in `_registerModelPrices` (TypeScript).

### Pricing improvements
- Fixed dead namespace-prefix keys in static pricing tables (Python + TypeScript) — keys like `"meta-llama/llama-3.3-70b"` were unreachable because namespace is stripped before lookup.
- Fixed `populate_from_openrouter` storing unstripped keys — now strips namespace on store.
- Added 8 new model entries: `llama-4-maverick`, `llama-4-scout`, `llama-3.3-70b`, `kimi-k2`, `deepseek-v3`, `deepseek-r1`, `gpt-5.4-pro`, `gpt-5.4`.
- OpenClaw plugin registers 30+ proprietary model prices at startup via `_registerModelPrices`.

### API deprecation fixes
- Replaced `@app.on_event("startup"/"shutdown")` with FastAPI `asynccontextmanager` lifespan.
- Registered explicit SQLite datetime/date adapters for Python 3.12 compatibility.

### All packages bumped to 0.2.0
`agentmetrics`, `agentmetrics-shared`, `agentmetrics-server`, `agentmetrics-anthropic`, `agentmetrics-autogen`, `agentmetrics-crewai`, `agentmetrics-langchain`, `agentmetrics-llamaindex`, `agentmetrics-openai-agents`, `agentmetrics-hermes`, `@agentmetrics/core`, `agentmetrics` (JS), `agentmetrics-anthropic` (JS), `agentmetrics-langchain` (JS). OpenClaw bumped to 0.3.0.

---

## June 18, 2026 — Audit hardening (all 49 issues resolved)

### Critical
- Fixed broken Alembic migration chain (002 placeholder restores PostgreSQL first-run)
- Fixed Anthropic Python/JS double-counting tool_calls on error results
- Fixed Sidebar navigation using `href` instead of React Router `to` (caused full-page reloads)

### High
- AuthContext: capped retries at 5 with exponential backoff (was infinite loop)
- API client 401: replaced hard redirect with `api:unauthorized` custom event (no React state loss)
- Docker: both API and dashboard containers now run as non-root users
- Removed test dependencies (pytest, httpx) from production requirements.txt
- AutoGen: added cache_read_tokens, cache_write_tokens, estimated_cost_usd to payloads
- Added loop_count field to EventCreate schema and router mapping
- Fixed self-hosting docs: correct ports (8099/3099), env vars, CLI commands, added backup guide

### Medium
- Added React ErrorBoundary to App.jsx
- Extracted shared helper functions (timeSince, fmtMs, fmtDur, agentDisplayName, healthOf, latencyColor) to src/lib/helpers.js — 6 files updated
- Fixed Seo.jsx hardcoded agentmetrics.dev URLs → window.location.origin
- Merged duplicate usePolling calls on DashboardPage into one 10s combined fetch
- LlamaIndex: bounded _root_cache with LRU eviction at 4096 entries
- LangChain JS: Path 2 (llmOutput fallback) now extracts cache tokens
- CrewAI: added threading.Lock to protect shared state under concurrent callbacks
- WAL directory (Hermes/OpenClaw) now created with chmod 0700; security notes added to docs
- CI: added PostgreSQL test job (api-test-postgres with postgres:16 service)
- CI: added compose smoke test job (full stack up + health check)
- Added dashboard nginx healthcheck to docker-compose.yml
- Mapped sdk_version to run_metadata in events router
- Removed dead env vars from render.yaml (SECRET_KEY, API_KEY_HMAC_SECRET) and fly.toml (build_target)
- Changed PostgreSQL default password placeholder in docker-compose.yml
- Added nginx cache headers for static assets (1-year immutable for JS/CSS, 30-day for images)
- Removed dead single_tenant config field from api/app/config.py

### Low
- Deleted dead PasswordInput.jsx component
- Removed dead PerformanceTab and ReliabilityTab from InsightsPage.jsx
- Fixed duplicate @keyframes vizPulse in AgentVisualizer.jsx
- Added 150ms debounce to CommandPalette search
- Fixed module-scoped _nextId in ToastContext → useRef (safe under HMR)
- Added role="img" to Logo SVG for accessibility; removed unused React import
- Created dashboard/postcss.config.js
- Removed unused React default import from 18 dashboard files (React 18 JSX transform)
- Fixed brittle model string manipulation in RunsTable.jsx
- Added VITE_AUTH_ENABLED removal from dashboard Dockerfile
- Removed duplicate pytest from requirements.txt; requirements-dev.txt is authoritative

---

## June 16, 2026

- Activity page: live agent monitoring with 5-second polling
- Setup page for first-run API key configuration
- Password/JWT auth replaced with API key auth
- SDK tracker hardened with typed events and retry logic
- Integration docs added for all 10 frameworks

---

## June 13, 2026 — Initial release

- FastAPI server with SQLite and PostgreSQL support
- React dashboard: Overview, Agents, Runs, Cost, Alerts, Integrations
- Python SDK: agentmetrics.track() decorator and configure()
- JS/TS SDK
- 10 integrations: LangChain, LangChain JS, CrewAI, LlamaIndex, OpenAI Agents, AutoGen, Anthropic, Anthropic JS, OpenClaw, Hermes
- Docker Compose one-command deployment
- Alert rules with Slack webhook notifications
- Python CLI: agentmetrics dashboard
