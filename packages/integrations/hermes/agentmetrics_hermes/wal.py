from __future__ import annotations

import json
import logging
import os
from base64 import b64decode, b64encode
from hashlib import sha256
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .pipeline import QueueItem

logger = logging.getLogger(__name__)

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # type: ignore[import-not-found]

    _HAS_CRYPTO = True
except ImportError:
    _HAS_CRYPTO = False


class WriteAheadLog:
    """Encrypted JSONL write-ahead log for crash-safe event delivery.

    Events are appended before queueing. Acknowledged (successfully flushed)
    events are removed at compaction time. On restart, recover() re-queues
    any unacknowledged entries so no events are silently lost.

    Encryption is AES-256-GCM when the cryptography package is available.
    Without it, events are stored as base64-encoded plaintext — still protected
    from casual inspection but not from a determined local attacker. Install
    `agentmetrics-hermes[crypto]` for full encryption.
    """

    def __init__(self, path: str, key: bytes | None = None) -> None:
        self._path = path
        self._key = key
        self._unacked: set[str] = set()
        os.makedirs(os.path.dirname(path), exist_ok=True)

    @classmethod
    def from_api_key(cls, path: str, api_key: str) -> WriteAheadLog:
        """Derive a 256-bit AES key from the API key via SHA-256."""
        key = sha256(api_key.encode()).digest() if api_key else None
        return cls(path, key)

    def append(self, item: QueueItem) -> None:
        event_id = str(item.event.get("event_id", ""))
        self._unacked.add(event_id)
        try:
            payload = json.dumps(item.event).encode()
            if self._key and _HAS_CRYPTO:
                iv = os.urandom(12)
                ct = AESGCM(self._key).encrypt(iv, payload, None)
                line = json.dumps(
                    {
                        "id": event_id,
                        "encrypted": True,
                        "iv": b64encode(iv).decode(),
                        "data": b64encode(ct).decode(),
                    }
                )
            else:
                line = json.dumps(
                    {"id": event_id, "encrypted": False, "data": b64encode(payload).decode()}
                )
            with open(self._path, "a") as fh:
                fh.write(line + "\n")
        except Exception:
            logger.exception("agentmetrics: WAL append failed")

    def recover(self) -> list[dict[str, Any]]:
        """Return all events not yet acknowledged. Called once at plugin startup."""
        if not os.path.exists(self._path):
            return []
        events: list[dict[str, Any]] = []
        try:
            with open(self._path) as fh:
                for raw in fh:
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        entry: dict[str, Any] = json.loads(raw)
                        event = self._decrypt(entry)
                        if event is not None:
                            events.append(event)
                            self._unacked.add(str(event.get("event_id", "")))
                    except (json.JSONDecodeError, KeyError, ValueError):
                        continue
        except Exception:
            logger.exception("agentmetrics: WAL recovery failed")
        return events

    def ack(self, items: list[QueueItem]) -> None:
        """Mark events as successfully delivered. Removes from the unacked set."""
        for item in items:
            self._unacked.discard(str(item.event.get("event_id", "")))

    def compact(self) -> None:
        """Rewrite WAL keeping only unacknowledged entries. Run periodically."""
        if not os.path.exists(self._path):
            return
        if not self._unacked:
            try:
                os.remove(self._path)
            except OSError:
                pass
            return
        kept: list[str] = []
        try:
            with open(self._path) as fh:
                for raw in fh:
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        entry = json.loads(raw)
                        if entry.get("id") in self._unacked:
                            kept.append(raw)
                    except json.JSONDecodeError:
                        continue
            with open(self._path, "w") as fh:
                for line in kept:
                    fh.write(line + "\n")
        except Exception:
            logger.exception("agentmetrics: WAL compaction failed")

    def _decrypt(self, entry: dict[str, Any]) -> dict[str, Any] | None:
        try:
            raw_data = b64decode(entry["data"])
            if entry.get("encrypted") and self._key and _HAS_CRYPTO:
                iv = b64decode(entry["iv"])
                plaintext = AESGCM(self._key).decrypt(iv, raw_data, None)
            elif not entry.get("encrypted"):
                plaintext = raw_data
            else:
                # Encrypted but no key — cannot decrypt; skip.
                return None
            return json.loads(plaintext)  # type: ignore[no-any-return]
        except Exception:
            return None
