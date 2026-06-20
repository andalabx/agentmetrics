from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .client import AgentMetricsClient
    from .config import AgentMetricsConfig
    from .wal import WriteAheadLog

logger = logging.getLogger(__name__)

_CB_THRESHOLD = 10         # consecutive failures before circuit opens
_CB_PROBE_SECS = 300       # 5 minutes before probing a closed circuit
_COMPACT_EVERY = 100       # WAL compactions every N acked events
_DLQ_ALERT_DEPTH = 100    # warn when DLQ grows past this


@dataclass
class QueueItem:
    event: dict[str, Any]
    attempt: int = 0
    enqueued_at: float = field(default_factory=time.time)


class CircuitBreaker:
    """Three-state circuit breaker: CLOSED → OPEN → HALF-OPEN → CLOSED."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    def __init__(self, threshold: int = _CB_THRESHOLD, probe_secs: int = _CB_PROBE_SECS) -> None:
        self.state = self.CLOSED
        self._threshold = threshold
        self._probe_secs = probe_secs
        self._consecutive_fails = 0
        self._opened_at: float | None = None
        self._lock = threading.Lock()

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_fails = 0
            if self.state == self.HALF_OPEN:
                self.state = self.CLOSED
                logger.info("agentmetrics: circuit breaker closed — API recovered")

    def record_failure(self) -> None:
        with self._lock:
            self._consecutive_fails += 1
            if self._consecutive_fails >= self._threshold and self.state != self.OPEN:
                self.state = self.OPEN
                self._opened_at = time.time()
                logger.warning(
                    "agentmetrics: circuit breaker OPEN after %d consecutive failures — "
                    "probing in %ds",
                    self._threshold,
                    self._probe_secs,
                )

    def is_open(self) -> bool:
        """Returns True when events should be dropped. Transitions to HALF-OPEN as a side-effect."""
        with self._lock:
            if self.state == self.OPEN:
                if self._opened_at and (time.time() - self._opened_at) >= self._probe_secs:
                    self.state = self.HALF_OPEN
                    logger.info("agentmetrics: circuit breaker HALF-OPEN — sending probe")
                    return False
                return True
            return False

    def force_close(self) -> None:
        with self._lock:
            self.state = self.CLOSED
            self._consecutive_fails = 0
            self._opened_at = None


class DeadLetterQueue:
    """Persistent file-backed DLQ for events that exceeded retry limits."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._items: list[QueueItem] = []
        self._load()

    def push(self, item: QueueItem) -> None:
        self._items.append(item)
        self._save()
        if len(self._items) >= _DLQ_ALERT_DEPTH:
            logger.warning("agentmetrics: DLQ depth %d — events are being lost", len(self._items))

    def drain(self) -> list[QueueItem]:
        items = list(self._items)
        self._items.clear()
        self._save()
        return items

    @property
    def depth(self) -> int:
        return len(self._items)

    def _load(self) -> None:
        try:
            with open(self._path) as fh:
                data = json.load(fh)
            self._items = [
                QueueItem(event=d["event"], attempt=d.get("attempt", 0)) for d in data
            ]
        except (FileNotFoundError, json.JSONDecodeError):
            self._items = []

    def _save(self) -> None:
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            with open(self._path, "w") as fh:
                json.dump(
                    [{"event": i.event, "attempt": i.attempt} for i in self._items], fh
                )
        except Exception:
            logger.exception("agentmetrics: failed to persist DLQ")


class EventPipeline:
    """Manages the event queue, background flush thread, retries, and circuit breaker."""

    def __init__(
        self,
        cfg: AgentMetricsConfig,
        client: AgentMetricsClient,
        wal: WriteAheadLog,
        dlq_path: str,
    ) -> None:
        self._cfg = cfg
        self._client = client
        self._wal = wal
        self.cb = CircuitBreaker()
        self.dlq = DeadLetterQueue(dlq_path)
        self._queue: queue.Queue[QueueItem] = queue.Queue(maxsize=cfg.queue_size)
        self._flush_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._acked_since_compact = 0
        self.sent = 0
        self.failed = 0
        self.dropped = 0

    def enqueue(self, event: dict[str, Any]) -> None:
        """Add event to the pipeline. Non-blocking; safe to call from any thread."""
        if self.cb.is_open():
            self.dropped += 1
            return
        item = QueueItem(event=event)
        self._wal.append(item)
        try:
            self._queue.put_nowait(item)
        except queue.Full:
            # FIFO overflow — discard the oldest to make room.
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(item)
            except queue.Empty:
                pass
            self.dropped += 1

    def start(self) -> None:
        if self._flush_thread and self._flush_thread.is_alive():
            return
        self._stop.clear()
        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True, name="am-flush")
        self._flush_thread.start()
        logger.info(
            "agentmetrics: flush thread started (interval=%ds, batch=%d)",
            self._cfg.flush_interval,
            self._cfg.batch_size,
        )

    def stop(self, flush_remaining: bool = True) -> None:
        self._stop.set()
        if flush_remaining and not self._queue.empty():
            self.flush_now()
        logger.info("agentmetrics: flush thread stopped (sent=%d failed=%d)", self.sent, self.failed)

    def flush_now(self) -> dict[str, int]:
        """Force-flush all queued events. Returns sent/failed counts."""
        result = {"sent": 0, "failed": 0}
        while not self._queue.empty() and not self.cb.is_open():
            batch = self._drain_batch()
            if not batch:
                break
            ok = self._send_batch(batch)
            if ok:
                result["sent"] += len(batch)
            else:
                result["failed"] += len(batch)
        return result

    def emit_audit(self, sub_type: str, metadata: dict[str, Any]) -> None:
        """Enqueue a synthetic audit event (best-effort; never raises)."""
        try:
            from .events import AuditEvent
            from .schema import audit_to_payload
            ev = AuditEvent(event_name=f"audit_{sub_type}", metadata=metadata)
            self._queue.put_nowait(QueueItem(event=audit_to_payload(ev)))
        except Exception:
            pass

    def retry_dlq(self) -> int:
        """Re-queue all DLQ events for another delivery attempt. Returns count re-queued."""
        items = self.dlq.drain()
        for item in items:
            item.attempt = 0
            try:
                self._queue.put_nowait(item)
            except queue.Full:
                self.dlq.push(item)
        return len(items)

    def _flush_loop(self) -> None:
        while not self._stop.wait(self._cfg.flush_interval):
            try:
                self.flush_now()
            except Exception:
                logger.exception("agentmetrics: unhandled error in flush loop")

    def _drain_batch(self) -> list[QueueItem]:
        batch: list[QueueItem] = []
        while len(batch) < self._cfg.batch_size:
            try:
                batch.append(self._queue.get_nowait())
            except queue.Empty:
                break
        return batch

    def _send_batch(self, batch: list[QueueItem]) -> bool:
        status, error = self._client.post_events([i.event for i in batch])

        if 200 <= status < 300 or status == 409:
            # 409 = idempotent duplicate — treat as success.
            self.cb.record_success()
            self.sent += len(batch)
            self._wal.ack(batch)
            self._acked_since_compact += len(batch)
            if self._acked_since_compact >= _COMPACT_EVERY:
                self._wal.compact()
                self._acked_since_compact = 0
            return True

        if 400 <= status < 500:
            # Client error — bad payload, not retryable.
            if status == 401:
                self.emit_audit("access_denied", {"status_code": status, "batch_size": len(batch)})
            self.cb.record_success()  # API is healthy; our data is wrong.
            self.failed += len(batch)
            self._wal.ack(batch)
            logger.warning("agentmetrics: HTTP %d — discarding %d events: %s", status, len(batch), error)
            return False

        # 5xx or network error — retry.
        self.cb.record_failure()
        for item in batch:
            item.attempt += 1
            if item.attempt >= self._cfg.retry_max_attempts:
                self.dlq.push(item)
                self.failed += 1
                logger.warning(
                    "agentmetrics: event exceeded %d retries → DLQ", self._cfg.retry_max_attempts
                )
                if self.dlq.depth == _DLQ_ALERT_DEPTH:
                    self.emit_audit("dlq_alert", {"depth": self.dlq.depth})
            else:
                try:
                    self._queue.put(item, block=False)
                except queue.Full:
                    self.dlq.push(item)
        return False
