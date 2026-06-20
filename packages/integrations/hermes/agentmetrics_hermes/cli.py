from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .config import AgentMetricsConfig
    from .pipeline import EventPipeline
    from .state import StateStore


def cmd_status(cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore) -> str:
    """Report plugin health, config, and live counters."""
    key_preview = (cfg.api_key[:8] + "..." + cfg.api_key[-4:]) if len(cfg.api_key) > 12 else "not set"
    lines = [
        "AgentMetrics — status",
        f"  API key            : {key_preview}",
        f"  Endpoint           : {cfg.endpoint}",
        f"  Redaction          : {cfg.redaction_mode}",
        f"  Tool names         : {cfg.exported_tool_names}",
        f"  Compress payloads  : {cfg.compress_payloads}",
        f"  Flush interval     : {cfg.flush_interval}s",
        f"  Batch size         : {cfg.batch_size}",
        "",
        f"  Circuit breaker    : {pipeline.cb.state}",
        f"  Queue depth        : {pipeline._queue.qsize()} / {cfg.queue_size}",
        f"  DLQ depth          : {pipeline.dlq.depth}",
        "",
        f"  Sent               : {pipeline.sent}",
        f"  Failed             : {pipeline.failed}",
        f"  Dropped (overflow) : {pipeline.dropped}",
    ]
    return "\n".join(lines)


def cmd_flush(pipeline: EventPipeline) -> str:
    """Force-flush all queued events immediately."""
    result = pipeline.flush_now()
    return f"Flushed — sent: {result['sent']}, failed: {result['failed']}"


def cmd_tail(store: StateStore) -> str:
    """Show active sessions and runs."""
    lines = ["AgentMetrics — active sessions"]
    with store._lock:  # noqa: SLF001 — CLI introspection only
        sessions = dict(store._sessions)
        runs = dict(store._runs)
        active = dict(store._active_run)

    if not sessions:
        lines.append("  (no active sessions)")
        return "\n".join(lines)

    now = time.time()
    for sk, sess in sessions.items():
        elapsed = int(now - sess.started_at)
        run_id = active.get(sk)
        run = runs.get(run_id or "")
        lines.append(f"  session: {sk[:20]}  elapsed: {elapsed}s  runs: {sess.run_count}")
        if run:
            run_elapsed = int(now - run.started_at)
            lines.append(
                f"    ↳ run: {run.run_id[:12]}  llm: {run.llm_calls}  tools: {run.tool_calls}"
                f"  elapsed: {run_elapsed}s"
            )
    return "\n".join(lines)


def cmd_test(cfg: AgentMetricsConfig) -> str:
    """Send a test event to verify connectivity."""
    from .client import AgentMetricsClient

    client = AgentMetricsClient(cfg)
    status, error = client.post_test_event()
    if 200 <= status < 300:
        return f"Delivered — HTTP {status}"
    return f"Failed — HTTP {status}: {error}"


def cmd_redaction_check(cfg: AgentMetricsConfig) -> str:
    """Show what the current redaction policy does to sample data."""
    from .redact import RedactionMode, active_mode, redact_tool_name, scrub_secrets

    mode = active_mode(cfg)
    samples = [
        ("OpenAI key", "sk-proj-abc123def456ghi789jkl012mno345pqr"),
        ("AgentMetrics key", "am_R4Z5nEek123456789012345678901234"),
        ("JWT token", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.abc123def456"),
        ("Password in JSON", 'password: "hunter2"'),
    ]
    lines = [f"AgentMetrics — redaction check (mode: {mode.value})", ""]
    lines.append("  Secret scrubbing:")
    for label, sample in samples:
        result = scrub_secrets(sample, mode)
        lines.append(f"    {label}: {result}")

    tool_names = ["bash", "read_file", "send_email", "web_search"]
    lines.append("")
    lines.append(f"  Tool name policy ({cfg.exported_tool_names}):")
    for name in tool_names:
        result = redact_tool_name(name, cfg)
        lines.append(f"    {name}: {result or '[not exported]'}")

    return "\n".join(lines)


def cmd_drain(pipeline: EventPipeline) -> str:
    """Retry all events in the dead-letter queue."""
    count = pipeline.retry_dlq()
    if count == 0:
        return "DLQ is empty — nothing to drain"
    return f"Retrying {count} DLQ event(s) — check `agentmetrics flush` to confirm delivery"


def cmd_cost(cfg: AgentMetricsConfig, pipeline: EventPipeline) -> str:
    """Display the model pricing table and any custom overrides."""
    from .pricing import MODEL_PRICING

    lines = ["AgentMetrics — pricing table (per million tokens, USD)", ""]
    lines.append(f"  {'Model':<30} {'Input':>8} {'Output':>8} {'CR':>8} {'CW':>8}")
    lines.append("  " + "-" * 66)
    for model, prices in MODEL_PRICING.items():
        inp = f"${prices[0]:.3f}" if prices[0] is not None else "—"
        out = f"${prices[1]:.3f}" if prices[1] is not None else "—"
        cr = f"${prices[2]:.3f}" if prices[2] is not None else "—"
        cw = f"${prices[3]:.3f}" if prices[3] is not None else "—"
        lines.append(f"  {model:<30} {inp:>8} {out:>8} {cr:>8} {cw:>8}")

    if cfg.cost_provider_table:
        lines.append("")
        lines.append("  Custom overrides:")
        for model, prices in cfg.cost_provider_table.items():
            lines.append(f"    {model}: {prices}")

    return "\n".join(lines)
