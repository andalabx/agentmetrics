from __future__ import annotations

import pytest

from agentmetrics_hermes.config import AgentMetricsConfig
from agentmetrics_hermes.client import AgentMetricsClient
from agentmetrics_hermes.pipeline import EventPipeline
from agentmetrics_hermes.state import StateStore
from agentmetrics_hermes.wal import WriteAheadLog


@pytest.fixture()
def cfg() -> AgentMetricsConfig:
    return AgentMetricsConfig(
        enabled=True,
        endpoint="http://localhost:8099",
        api_key="am_test_key_1234567890",
        flush_interval=9999,  # never auto-flush in tests
        batch_size=100,
        queue_size=1000,
        retry_max_attempts=3,
    )


@pytest.fixture()
def store() -> StateStore:
    return StateStore()


@pytest.fixture()
def tmp_wal(tmp_path: pytest.TempPathFactory) -> WriteAheadLog:
    return WriteAheadLog(str(tmp_path / "test-wal.jsonl"))


@pytest.fixture()
def pipeline(cfg: AgentMetricsConfig, tmp_wal: WriteAheadLog, tmp_path: pytest.TempPathFactory) -> EventPipeline:
    # Stub client that always returns 201.
    class _OkClient:
        def post_events(self, payloads: list) -> tuple[int, str]:
            return 201, ""

        def post_test_event(self) -> tuple[int, str]:
            return 201, ""

    dlq_path = str(tmp_path / "dlq.json")
    p = EventPipeline(cfg, _OkClient(), tmp_wal, dlq_path)  # type: ignore[arg-type]
    return p
