"""AgentMetrics observability plugin for Hermes Agent.

Drop-in Python plugin for Hermes' native plugin system. After installation:

    pip install agentmetrics-hermes

Add to your Hermes config.yaml:

    plugins:
      agentmetrics:
        enabled: true
        endpoint: http://localhost:8099
        api_key: am_your_key_here
      enabled:
        - agentmetrics

Events flow automatically from the next gateway restart.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from .client import AgentMetricsClient
from .config import AgentMetricsConfig
from .hooks import AgentMetricsHooks
from .pipeline import EventPipeline
from .state import StateStore
from .wal import WriteAheadLog

__version__ = "0.2.2"
__all__ = ["register"]

logger = logging.getLogger(__name__)

# Module-level references so CLI commands can reach the live pipeline and store.
_pipeline: EventPipeline | None = None
_store: StateStore | None = None
_cfg: AgentMetricsConfig | None = None

_HOOK_NAMES = [
    ("on_session_start", "on_session_start"),
    ("on_session_end", "on_session_end"),
    ("pre_llm_call", "pre_llm_call"),
    ("post_llm_call", "post_llm_call"),
    ("pre_api_request", "pre_api_request"),
    ("post_api_request", "post_api_request"),
    ("api_request_error", "api_request_error"),
    ("pre_tool_call", "pre_tool_call"),
    ("post_tool_call", "post_tool_call"),
    # Future hooks — registered when Hermes exposes them.
    ("on_subagent_spawn", "on_subagent_spawn"),
    ("on_subagent_end", "on_subagent_end"),
    ("on_skill_load", "on_skill_load"),
    ("on_memory_write", "on_memory_write"),
    ("on_session_search", "on_session_search"),
    ("on_cron_start", "on_cron_start"),
    ("on_cron_end", "on_cron_end"),
    ("on_gateway_connect", "on_gateway_connect"),
    ("on_gateway_disconnect", "on_gateway_disconnect"),
    ("on_gateway_reconnect", "on_gateway_reconnect"),
    ("on_retry", "on_retry"),
    ("on_timeout", "on_timeout"),
    ("on_cancel", "on_cancel"),
    ("on_failure", "on_failure"),
    ("on_before_compaction", "on_before_compaction"),
    ("on_before_reset", "on_before_reset"),
]


def register(ctx: Any) -> None:
    """Hermes plugin entry point. Called once by the gateway on startup."""
    global _pipeline, _store, _cfg

    cfg = AgentMetricsConfig.load()

    if not cfg.enabled:
        logger.info("agentmetrics: disabled — set plugins.agentmetrics.enabled=true")
        return

    if not cfg.api_key:
        logger.warning(
            "agentmetrics: no API key configured — set AGENTMETRICS_API_KEY or "
            "plugins.agentmetrics.api_key in config.yaml"
        )
        return

    hermes_home = os.environ.get("HERMES_HOME") or os.path.join(
        os.environ.get("HOME") or os.path.expanduser("~"), ".hermes"
    )
    wal_path = os.path.join(hermes_home, "agentmetrics-wal.jsonl")
    dlq_path = os.path.join(hermes_home, "agentmetrics-dlq.json")

    wal = WriteAheadLog.from_api_key(wal_path, cfg.api_key)

    # Recover any events that were queued but not flushed before last shutdown.
    recovered = wal.recover()

    client = AgentMetricsClient(cfg)
    store = StateStore()
    pipeline = EventPipeline(cfg, client, wal, dlq_path)
    pipeline.start()

    if recovered:
        logger.info("agentmetrics: recovering %d event(s) from WAL", len(recovered))
        from .pipeline import QueueItem

        for event in recovered:
            pipeline._queue.put_nowait(QueueItem(event=event))
        pipeline.emit_audit("wal_recovery", {"recovered_count": len(recovered)})

    hooks = AgentMetricsHooks(cfg, pipeline, store)

    registered = 0
    for hermes_hook, method_name in _HOOK_NAMES:
        handler = getattr(hooks, method_name, None)
        if handler is None:
            continue
        try:
            ctx.register_hook(hermes_hook, handler)
            registered += 1
        except Exception:
            # Hermes may not expose all hooks yet — skip unknown ones silently.
            pass

    # Register CLI commands via Hermes plugin API when available.
    _register_cli(ctx, cfg, pipeline, store)

    # Store for CLI/introspection access.
    _pipeline = pipeline
    _store = store
    _cfg = cfg

    logger.info(
        "agentmetrics: plugin registered — %d hooks active, %d WAL event(s) recovered",
        registered,
        len(recovered),
    )


def _register_cli(ctx: Any, cfg: AgentMetricsConfig, pipeline: EventPipeline, store: StateStore) -> None:
    """Register `agentmetrics <command>` in Hermes CLI when the API supports it."""
    from . import cli

    commands = {
        "status": lambda **_: cli.cmd_status(cfg, pipeline, store),
        "flush": lambda **_: cli.cmd_flush(pipeline),
        "tail": lambda **_: cli.cmd_tail(store),
        "test": lambda **_: cli.cmd_test(cfg),
        "redaction-check": lambda **_: cli.cmd_redaction_check(cfg),
        "drain": lambda **_: cli.cmd_drain(pipeline),
        "cost": lambda **_: cli.cmd_cost(cfg, pipeline),
    }

    for name, handler in commands.items():
        try:
            ctx.register_command(f"agentmetrics {name}", handler)
        except (AttributeError, TypeError):
            # Hermes version without register_command — CLI commands unavailable until updated.
            break
