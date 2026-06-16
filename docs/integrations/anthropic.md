# Anthropic Integration (Python)

Track cost, latency, token usage, and errors for the Anthropic Python SDK (`anthropic`).

## Install

```bash
pip install agentmetrics agentmetrics-anthropic
```

## Quick Start

```python
import agentmetrics
from agentmetrics_anthropic import instrument_anthropic

agentmetrics.configure(api_key="am_your_key", server_url="http://localhost:4000")
instrument_anthropic()

# Your existing Anthropic code — no other changes needed
import anthropic

client = anthropic.Anthropic()
message = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello, Claude!"}],
)
```

## With Streaming

Streaming responses are fully supported — token counts are extracted from the final `message_delta` event:

```python
with client.messages.stream(
    model="claude-opus-4-7",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Tell me a story."}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

## Per-Run Configuration

```python
instrument_anthropic(
    agent_id="document-summarizer",
    environment="production",
    version="1.0.0",
)
```

## What Gets Tracked

| Metric | Source |
|--------|--------|
| Input / output tokens | `usage` from message response |
| Cache read / write tokens | `cache_read_input_tokens` / `cache_creation_input_tokens` |
| Cost (USD) | Computed from Anthropic model pricing table |
| Latency (ms) | API call wall-clock time |
| Error messages | Exception message on API errors |
| Model name | `model` field in response |

## Notes

- `status_terminated` errors (e.g., max tokens reached) are counted as errors in the dashboard.
- State is reset per-run so concurrent calls don't bleed into each other.
- `instrument_anthropic()` is idempotent — the patch is applied only once.
