# Contributing to AgentMetrics

Thanks for your interest. Here's the short version of everything you need.

---

## Project layout

```
agentmetrics/
├── api/            FastAPI backend (Python)
├── dashboard/      Vite + React frontend
├── packages/
│   ├── python/     Python SDK (pip install agentmetrics)
│   ├── js/         JS/TS SDK (npm install agentmetrics)
│   └── integrations/  Per-framework wrappers (LangChain, CrewAI, …)
└── docker-compose.yml
```

---

## Run locally

**API**

```bash
cd api
pip install -e ".[postgres]"
uvicorn app.main:app --reload --port 8099
```

The server creates a SQLite database at `./agentmetrics.db` on first run and prints an SDK key to stdout.

**Dashboard**

```bash
cd dashboard
npm install
npm run dev
```

Opens at `http://localhost:3099`. Vite proxies `/v1/` to the API automatically.

---

## Tests

```bash
cd api
pytest tests/ -v
```

Tests use SQLite - no database setup needed.

---

## Making changes

1. Fork the repo and create a branch off `main`.
2. Keep changes focused - one thing per PR.
3. If you add a backend endpoint, add a test for it.
4. If you add a dashboard feature, make sure `npm run build` passes.
5. Open a PR - CI runs automatically.

---

## What to work on

Check the [issues](../../issues) tab. Good first issues are labelled `good first issue`.

High-value areas:
- New SDK integrations (`packages/integrations/`)
- Dashboard improvements (Vite + React + Tailwind)
- API performance or new endpoints
- Documentation and examples

---

## Code style

- **Python**: Ruff for linting and formatting (`uv run ruff check --fix && uv run ruff format`). mypy for type checking.
- **TypeScript**: ESLint + Prettier (`pnpm lint`). `strict: true` in tsconfig.
- **Commits**: Conventional Commits format (`feat(scope): description`).
- **Comments**: explain why, not what. No decorative separators.

Full standards: [`.internal/CODE.md`](.internal/CODE.md)

---

## Questions

Open an issue or start a discussion. Response time is best on GitHub.
