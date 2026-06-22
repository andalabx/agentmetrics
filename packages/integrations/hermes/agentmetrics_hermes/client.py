from __future__ import annotations

import gzip
import json
import logging
import urllib.error
import urllib.request
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .config import AgentMetricsConfig

try:
    from importlib.metadata import version as _pkg_version
    _VERSION = _pkg_version("agentmetrics-hermes")
except Exception:
    _VERSION = "unknown"

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 5   # seconds
_READ_TIMEOUT = 15     # seconds
_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024  # 10 MB hard cap per batch (DoS guard)


class AgentMetricsClient:
    """HTTP transport for the AgentMetrics ingest API. Uses stdlib urllib — no extra deps."""

    def __init__(self, cfg: AgentMetricsConfig) -> None:
        self._endpoint = cfg.endpoint.rstrip("/")
        self._api_key = cfg.api_key
        self._compress = cfg.compress_payloads

    def post_events(self, payloads: list[dict[str, Any]]) -> tuple[int, str]:
        """POST a batch of event dicts to /v1/events/batch. Returns (status_code, error_message)."""
        url = f"{self._endpoint}/v1/events/batch"
        body = json.dumps({"events": payloads}).encode()

        if len(body) > _MAX_PAYLOAD_BYTES:
            logger.warning(
                "agentmetrics: batch payload %d bytes exceeds %d byte cap — dropping",
                len(body),
                _MAX_PAYLOAD_BYTES,
            )
            return 413, "payload too large"

        headers = self._headers()
        if self._compress and len(body) > 1024:
            body = gzip.compress(body)
            headers["Content-Encoding"] = "gzip"
        headers["Content-Length"] = str(len(body))

        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(
                req, timeout=max(_CONNECT_TIMEOUT, _READ_TIMEOUT)
            ) as resp:
                return resp.status, ""
        except urllib.error.HTTPError as exc:
            return exc.code, str(exc.reason)
        except urllib.error.URLError as exc:
            return 0, str(exc.reason)
        except TimeoutError:
            return 0, "timeout"
        except Exception as exc:
            return 0, str(exc)

    def post_test_event(self) -> tuple[int, str]:
        """Send a minimal test event. Used by the `agentmetrics test` CLI command."""
        import time
        import uuid

        payload = [
            {
                "event_id": str(uuid.uuid4()),
                "trace_id": str(uuid.uuid4()),
                "event_name": "plugin_test",
                "agent_id": "hermes",
                "platform": "hermes",
                "ts": int(time.time() * 1000),
                "status": "success",
            }
        ]
        return self.post_events(payload)

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-API-Key": self._api_key,
            "User-Agent": f"agentmetrics-hermes/{_VERSION}",
        }
