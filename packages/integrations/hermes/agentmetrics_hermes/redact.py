from __future__ import annotations

import logging
import re
import time
from enum import StrEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .config import AgentMetricsConfig

logger = logging.getLogger(__name__)

# Patterns that identify secrets in free-form text.
# Order matters — more specific patterns first.
_SECRET_PATTERNS: list[tuple[str, str]] = [
    (r"sk-[A-Za-z0-9\-_]{20,}", "[REDACTED]"),
    (r"am_[A-Za-z0-9\-_]{16,}", "[REDACTED]"),
    # JWT-like tokens (two or more base64url segments separated by dots)
    (r"\bey[A-Za-z0-9\-_]{8,}(?:\.[A-Za-z0-9\-_]{4,}){1,}", "[REDACTED]"),
    # Key-value patterns: api_key=<value>, password: <value>, etc.
    (
        r"(?i)(?:api[-_]?key|apikey|api[-_]?token|access[-_]?token|"
        r"secret|password|passwd|auth)[=:\s\"']+([^\s\"'&,\]\}\n]{8,})",
        r"\1=[REDACTED]",
    ),
]

_COMPILED_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(p), r) for p, r in _SECRET_PATTERNS
]

# FNV-1a 32-bit constants for tool name hashing (matches npm package implementation).
_FNV_OFFSET = 2166136261
_FNV_PRIME = 16777619


class RedactionMode(StrEnum):
    STRICT = "strict"
    MODERATE = "moderate"
    DEBUG = "debug"


def active_mode(cfg: AgentMetricsConfig) -> RedactionMode:
    """Return current redaction mode, honouring debug auto-expiry."""
    try:
        mode = RedactionMode(cfg.redaction_mode)
    except ValueError:
        mode = RedactionMode.STRICT

    if mode == RedactionMode.DEBUG and cfg.debug_expires_at is not None:
        if time.time() > cfg.debug_expires_at:
            logger.info("agentmetrics: debug mode expired — reverting to strict")
            return RedactionMode.STRICT

    return mode


def scrub_secrets(text: str, mode: RedactionMode) -> str:
    """Remove API keys, tokens, and passwords from a string."""
    scrubbed, _ = scrub_secrets_and_count(text, mode)
    return scrubbed


def scrub_secrets_and_count(text: str, mode: RedactionMode) -> tuple[str, int]:
    """Scrub secrets and return (scrubbed_text, replacement_count).

    Counts how many secret patterns were redacted. Used to populate
    secrets_blocked_count on agent_end events.
    Always runs in strict and moderate modes; skips in debug mode.
    """
    if not text or mode == RedactionMode.DEBUG:
        return text, 0
    result = text
    total = 0
    for pattern, replacement in _COMPILED_PATTERNS:
        result, n = pattern.subn(replacement, result)
        total += n
    return result, total


def redact_tool_name(name: str, cfg: AgentMetricsConfig) -> str | None:
    """Apply tool name export policy. Returns None when the name must not be sent."""
    policy = cfg.exported_tool_names

    if policy == "off":
        return None

    if policy == "blocklist":
        if name in (cfg.redact_tool_names or []):
            return _hash_name(name)
        return name

    if policy == "allowlist":
        # Only names explicitly in redact_tool_names are exported.
        if name in (cfg.redact_tool_names or []):
            return name
        return None

    if policy == "hash":
        return _hash_name(name)

    return name


def scrub_event(payload: dict[str, Any], mode: RedactionMode) -> dict[str, Any]:
    """Scrub secrets from all string fields in an event payload dict."""
    if mode == RedactionMode.DEBUG:
        return payload
    result, _ = _scrub_dict_and_count(payload, mode)
    return result  # type: ignore[return-value]


def scrub_event_and_count(payload: dict[str, Any], mode: RedactionMode) -> tuple[dict[str, Any], int]:
    """Scrub secrets from all string fields, returning (scrubbed_payload, total_blocked).

    Used by _enqueue() to populate secrets_blocked_count on agent_end events.
    """
    if mode == RedactionMode.DEBUG:
        return payload, 0
    result, total = _scrub_dict_and_count(payload, mode)
    return result, total  # type: ignore[return-value]


def _scrub_dict(obj: Any, mode: RedactionMode) -> Any:
    result, _ = _scrub_dict_and_count(obj, mode)
    return result


def _scrub_dict_and_count(obj: Any, mode: RedactionMode) -> tuple[Any, int]:
    if isinstance(obj, str):
        return scrub_secrets_and_count(obj, mode)
    if isinstance(obj, dict):
        result_dict: dict[str, Any] = {}
        total = 0
        for k, v in obj.items():
            scrubbed_v, n = _scrub_dict_and_count(v, mode)
            result_dict[k] = scrubbed_v
            total += n
        return result_dict, total
    if isinstance(obj, list):
        result_list = []
        total = 0
        for v in obj:
            scrubbed_v, n = _scrub_dict_and_count(v, mode)
            result_list.append(scrubbed_v)
            total += n
        return result_list, total
    return obj, 0


def _hash_name(name: str) -> str:
    """FNV-1a 32-bit hash for tool name pseudonymisation. Same algorithm as npm package."""
    h = _FNV_OFFSET
    for byte in name.encode():
        h = (h ^ byte) * _FNV_PRIME & 0xFFFFFFFF
    return f"t_{h:08x}"


def redaction_policy_version(mode: RedactionMode) -> str:
    return f"v1-{mode.value}"
