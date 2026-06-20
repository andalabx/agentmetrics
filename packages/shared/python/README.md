# agentmetrics-shared

[![PyPI](https://img.shields.io/pypi/v/agentmetrics-shared?color=6366f1&label=pypi&logo=python&logoColor=white)](https://pypi.org/project/agentmetrics-shared)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](../../LICENSE)

Shared core library for all AgentMetrics Python integrations. Provides model cost estimation, PII/secret redaction, and event transport utilities.

This package is a runtime dependency of the AgentMetrics integration packages — you do not need to install it directly.

---

## What's included

| Module | Purpose |
|---|---|
| `pricing` | Token cost estimation for 50+ LLM models |
| `redact` | Secret and PII scrubbing with configurable redaction modes |
| `transport` | HTTP event delivery with WAL, circuit breaker, and retry logic |

---

## License

[MIT](../../LICENSE)
