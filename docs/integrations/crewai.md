# CrewAI Integration

Track cost, latency, token usage, and errors for CrewAI crews and tasks.

## Install

```bash
pip install agentmetrics agentmetrics-crewai
```

## Quick Start

```python
import agentmetrics
from agentmetrics_crewai import instrument_crewai

agentmetrics.configure(api_key="am_your_key", server_url="http://localhost:4000")
instrument_crewai()

# Your existing crew code — no other changes needed
crew = Crew(agents=[...], tasks=[...])
result = crew.kickoff()
```

## Per-Run Configuration

```python
instrument_crewai(
    agent_id="research-crew",
    environment="production",
    version="1.0.0",
)
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | CrewAI LLM usage |
| Cost (USD) | Computed from model pricing table |
| Latency (ms) | `kickoff()` wall-clock time |
| Tool calls | Per-task tool usage |
| Tool errors | Tool failure exceptions |
| Agent steps | Task count |
| Error messages | Crew-level exceptions |

## Notes

- Each `crew.kickoff()` call is tracked as a separate run with a unique trace ID.
- `instrument_crewai()` is idempotent — safe to call multiple times.
