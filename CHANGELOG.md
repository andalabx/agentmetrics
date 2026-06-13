# Changelog

All notable changes to AgentMetrics are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added
- **No-auth open deployment** — server is fully open by default; no API keys, no login, no signup required. Self-hosted instances start immediately with `docker compose up`.
- **Python CLI** — `agentmetrics dashboard` launches the stack via Docker Compose or falls back to `agentmetrics-server` pip package.
- **Live view** — `/live` page polls active agents every 5 s and shows real-time status, cost, and run counts with an animated pulse indicator in the sidebar.
- **Cost view** — `/cost` page (previously `/insights`) with monthly spend, week-over-week comparison, and per-agent cost breakdown.
- **7-item navigation** — Overview, Agents, Live, Cost, Alerts, Integrations, Account; sidebar rebuilt with semantic groups and keyboard-accessible command palette.
- **Static SPA bundling** — FastAPI serves the pre-built dashboard from `api/app/static/` when present, enabling single-binary pip deployments.
- **OpenClaw plugin v0.3.0** — migrated from hook-based to pure plugin architecture; zero code changes required in agent projects.
- **Hermes plugin** — new integration for the Hermes agent runtime.
- **AutoGen integration** (`agentmetrics-autogen`) — wraps AutoGen `GroupChat` and `AssistantAgent` runs.
- **Anthropic Python integration** (`agentmetrics-anthropic`) — session-level tracking for `client.messages.create` calls.
- **10 framework integrations total**: LangChain, LangChain JS, CrewAI, LlamaIndex, OpenAI Agents, AutoGen, Anthropic, Anthropic JS, OpenClaw, Hermes.
- **GitHub Actions CI** — lint (ruff), pytest (SQLite), dashboard build, and Docker image build on every push and PR.

### Changed
- `agentmetrics.configure()` — `api_key` parameter is now optional (defaults to empty string); pass `base_url` to point at your server. SDKs omit the `Authorization` header when no key is provided.
- All integration code examples and onboarding snippets updated to use `base_url="http://localhost:8099"` instead of `api_key=`.
- Integrations page (`/connect`) rebuilt — removed SDK key panel, all setup guides now show `base_url` configure step.
- Dashboard onboarding overlay reduced from 4 steps to 3 (removed API key step).
- Account page — removed Credentials tab with rotate-key UI.
- `configure()` in both Python and JS SDKs accepts `base_url` as the primary connection parameter.

### Removed
- **All authentication** — JWT, bcrypt password hashing, API key generation, `rotate-key` endpoint, `ApiKey` DB model, `api_key_hash` rate-limiting, `AUTH_ENABLED` flag.
- `python-jose`, `passlib`, `email-validator` removed from API dependencies.
- `SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `API_KEY_HMAC_SECRET`, `AUTH_ENABLED` removed from all env files, Docker Compose files, and CI configuration.
- Login, signup, forgot-password, and reset-password routes and pages.

---

## [0.1.2] - 2026-05-01

### Added
- Python SDK: `agentmetrics.track()` decorator and context manager
- JS/TS SDK: `agentmetrics.track()` function with full TypeScript types
- LangChain Python callback handler (`agentmetrics-langchain`)
- LangChain JS callback handler
- CrewAI listener (`agentmetrics-crewai`)
- LlamaIndex callback (`agentmetrics-llamaindex`)

### Fixed
- Cost estimation for Claude 3.5 Haiku cache token pricing
- Batch event endpoint idempotency on duplicate trace IDs

---

## [0.1.0] - 2026-04-01

### Added
- Initial release
- FastAPI backend with SQLite and PostgreSQL support
- Vite + React dashboard
- Python SDK v0.1.0
- JS SDK v0.1.0
- Basic agent tracking: cost, latency, success rate
- Alert rules with Slack webhook notifications
- Fleet health overview
- Docker Compose one-command deployment
- Self-contained auth with JWT and bcrypt (removed in [Unreleased])
- In-memory sliding-window rate limiter (no Redis required)
