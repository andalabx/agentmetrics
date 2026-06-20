from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_DEFAULT_ENDPOINT = "http://localhost:8099"


def _validate_endpoint(url: str) -> str:
    """Reject non-HTTP/HTTPS schemes. Warn (not block) on non-HTTPS for non-localhost URLs."""
    try:
        parsed = urlparse(url)
    except Exception:
        logger.warning("agentmetrics: invalid endpoint URL, falling back to default")
        return _DEFAULT_ENDPOINT
    if parsed.scheme not in ("http", "https"):
        logger.warning(
            "agentmetrics: endpoint scheme %r is not http/https — using default", parsed.scheme
        )
        return _DEFAULT_ENDPOINT
    host = parsed.hostname or ""
    is_local = host in ("localhost", "127.0.0.1", "::1") or host.startswith("192.168.")
    if parsed.scheme == "http" and not is_local:
        # Warn operators who send telemetry over plain HTTP to a remote host.
        logger.warning(
            "agentmetrics: endpoint %r uses plain HTTP to a non-local host — "
            "API keys and event data will be sent unencrypted. Use HTTPS in production.",
            url,
        )
    return url


@dataclass
class AgentMetricsConfig:
    enabled: bool = True
    endpoint: str = _DEFAULT_ENDPOINT
    api_key: str = ""
    flush_interval: int = 10
    batch_size: int = 100
    queue_size: int = 10_000
    retry_max_attempts: int = 5
    redaction_mode: str = "strict"
    exported_tool_names: str = "blocklist"
    redact_tool_names: list[str] = field(default_factory=list)
    compress_payloads: bool = False
    cost_provider_table: dict[str, list[float | None]] = field(default_factory=dict)
    debug_expires_at: float | None = None

    @classmethod
    def load(cls) -> AgentMetricsConfig:
        """Read from Hermes config.yaml plugins.agentmetrics.* section."""
        try:
            from hermes_cli.config import cfg_get, load_config  # type: ignore[import-not-found]

            config = load_config()
            raw = cfg_get(config, "plugins", "agentmetrics", default={})
            if not isinstance(raw, dict):
                return cls(enabled=False)
            api_key = str(
                raw.get("api_key") or os.environ.get("AGENTMETRICS_API_KEY", "")
            )
            raw_endpoint = str(
                os.environ.get("AGENTMETRICS_URL")
                or raw.get("endpoint", _DEFAULT_ENDPOINT)
            )
            endpoint = _validate_endpoint(raw_endpoint)
            return cls(
                enabled=bool(raw.get("enabled", True)),
                endpoint=endpoint,
                api_key=api_key,
                flush_interval=int(raw.get("flush_interval", cls.flush_interval)),
                batch_size=int(raw.get("batch_size", cls.batch_size)),
                queue_size=int(raw.get("queue_size", cls.queue_size)),
                retry_max_attempts=int(raw.get("retry_max_attempts", cls.retry_max_attempts)),
                redaction_mode=str(raw.get("redaction_mode", cls.redaction_mode)),
                exported_tool_names=str(
                    raw.get("exported_tool_names", cls.exported_tool_names)
                ),
                redact_tool_names=list(raw.get("redact_tool_names") or []),
                compress_payloads=bool(raw.get("compress_payloads", False)),
                cost_provider_table=dict(raw.get("cost_provider_table") or {}),
            )
        except ImportError:
            # Hermes not installed — config comes from env vars only.
            api_key = os.environ.get("AGENTMETRICS_API_KEY", "")
            raw_endpoint = os.environ.get("AGENTMETRICS_URL", _DEFAULT_ENDPOINT)
            return cls(
                enabled=bool(api_key),
                endpoint=_validate_endpoint(raw_endpoint),
                api_key=api_key,
            )
        except Exception:
            logger.exception("agentmetrics: failed to load config")
            return cls(enabled=False)
