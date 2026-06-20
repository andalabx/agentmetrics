from __future__ import annotations

import queue
import threading
import time

import pytest

from agentmetrics_hermes.config import AgentMetricsConfig
from agentmetrics_hermes.pipeline import CircuitBreaker, DeadLetterQueue, EventPipeline, QueueItem
from agentmetrics_hermes.wal import WriteAheadLog


@pytest.mark.unit
def test_enqueue_and_flush(pipeline: EventPipeline) -> None:
    pipeline.enqueue({"event_id": "a", "event_name": "test"})
    result = pipeline.flush_now()
    assert result["sent"] == 1
    assert result["failed"] == 0


@pytest.mark.unit
def test_queue_full_drops_oldest(cfg: AgentMetricsConfig, tmp_path: pytest.TempPathFactory) -> None:
    cfg.queue_size = 2

    class _OkClient:
        def post_events(self, p: list) -> tuple[int, str]:
            return 201, ""

    wal = WriteAheadLog(str(tmp_path / "wal.jsonl"))
    p = EventPipeline(cfg, _OkClient(), wal, str(tmp_path / "dlq.json"))  # type: ignore[arg-type]

    for i in range(5):
        p.enqueue({"event_id": str(i)})

    # Queue was capped — some events dropped, but it doesn't raise.
    assert p.dropped >= 3


@pytest.mark.unit
def test_circuit_breaker_opens_after_threshold() -> None:
    cb = CircuitBreaker(threshold=3, probe_secs=9999)
    for _ in range(3):
        cb.record_failure()
    assert cb.state == CircuitBreaker.OPEN


@pytest.mark.unit
def test_circuit_breaker_half_open_after_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    cb = CircuitBreaker(threshold=1, probe_secs=0)
    cb.record_failure()
    assert cb.state == CircuitBreaker.OPEN
    # probe_secs=0 means it should transition to HALF_OPEN immediately.
    assert cb.is_open() is False
    assert cb.state == CircuitBreaker.HALF_OPEN


@pytest.mark.unit
def test_circuit_breaker_closes_on_success() -> None:
    cb = CircuitBreaker(threshold=1, probe_secs=0)
    cb.record_failure()
    cb.is_open()  # transition to HALF_OPEN
    cb.record_success()
    assert cb.state == CircuitBreaker.CLOSED


@pytest.mark.unit
def test_retry_moves_to_dlq_after_max_attempts(
    cfg: AgentMetricsConfig, tmp_path: pytest.TempPathFactory
) -> None:
    cfg.retry_max_attempts = 2

    class _FailClient:
        def post_events(self, p: list) -> tuple[int, str]:
            return 500, "server error"

    wal = WriteAheadLog(str(tmp_path / "wal.jsonl"))
    p = EventPipeline(cfg, _FailClient(), wal, str(tmp_path / "dlq.json"))  # type: ignore[arg-type]
    p.enqueue({"event_id": "x"})

    # Flush 3 times: first flush retries, second exceeds limit → DLQ.
    for _ in range(3):
        p.flush_now()

    assert p.dlq.depth >= 1


@pytest.mark.unit
def test_dlq_persist_and_drain(tmp_path: pytest.TempPathFactory) -> None:
    path = str(tmp_path / "dlq.json")
    dlq = DeadLetterQueue(path)
    item = QueueItem(event={"event_id": "dlq-1"})
    dlq.push(item)
    assert dlq.depth == 1

    dlq2 = DeadLetterQueue(path)  # re-load from disk
    assert dlq2.depth == 1
    items = dlq2.drain()
    assert len(items) == 1
    assert items[0].event["event_id"] == "dlq-1"
