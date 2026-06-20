"""Integration tests — require a live AgentMetrics API.

Run with: pytest -m integration --api-url http://localhost:8099 --api-key am_xxx
"""

from __future__ import annotations

import time

import pytest

from agentmetrics_hermes.config import AgentMetricsConfig
from agentmetrics_hermes.hooks import AgentMetricsHooks
from agentmetrics_hermes.pipeline import EventPipeline
from agentmetrics_hermes.state import StateStore
from agentmetrics_hermes.wal import WriteAheadLog


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--api-url", default="http://localhost:8099")
    parser.addoption("--api-key", default="")


@pytest.fixture()
def live_cfg(request: pytest.FixtureRequest) -> AgentMetricsConfig:
    return AgentMetricsConfig(
        enabled=True,
        endpoint=request.config.getoption("--api-url"),
        api_key=request.config.getoption("--api-key"),
        flush_interval=9999,
    )


@pytest.mark.integration
def test_end_to_end(live_cfg: AgentMetricsConfig, tmp_path: pytest.TempPathFactory) -> None:
    """Full pipeline: hook fires → event queued → flushed → API receives."""
    from agentmetrics_hermes.client import AgentMetricsClient

    wal = WriteAheadLog(str(tmp_path / "wal.jsonl"))
    client = AgentMetricsClient(live_cfg)
    store = StateStore()
    pipeline = EventPipeline(live_cfg, client, wal, str(tmp_path / "dlq.json"))
    pipeline.start()
    hooks = AgentMetricsHooks(live_cfg, pipeline, store)

    hooks.on_session_start(session_id="integration-test-session")
    hooks.pre_api_request(session_id="integration-test-session", model="claude-sonnet-4-6")
    hooks.pre_tool_call(session_id="integration-test-session", tool_name="bash", tool_call_id="tc-1")
    hooks.post_tool_call(session_id="integration-test-session", tool_name="bash", tool_call_id="tc-1", status="ok")
    hooks.post_api_request(
        session_id="integration-test-session",
        model="claude-sonnet-4-6",
        usage={"input_tokens": 100, "output_tokens": 50},
        finish_reason="stop",
    )
    hooks.on_session_end(session_id="integration-test-session")

    result = pipeline.flush_now()
    pipeline.stop(flush_remaining=False)

    assert result["sent"] > 0, f"No events sent — failed: {result['failed']}"
    assert result["failed"] == 0


@pytest.mark.integration
def test_wal_recovery(live_cfg: AgentMetricsConfig, tmp_path: pytest.TempPathFactory) -> None:
    """Events written to WAL survive a simulated crash and are re-sent on restart."""
    from agentmetrics_hermes.client import AgentMetricsClient
    from agentmetrics_hermes.pipeline import QueueItem

    wal_path = str(tmp_path / "wal.jsonl")

    # Phase 1: enqueue but do NOT flush (simulate crash).
    wal = WriteAheadLog(wal_path)
    store = StateStore()
    client = AgentMetricsClient(live_cfg)
    pipeline = EventPipeline(live_cfg, client, wal, str(tmp_path / "dlq.json"))
    hooks = AgentMetricsHooks(live_cfg, pipeline, store)
    hooks.on_session_start(session_id="wal-recovery-test")
    assert pipeline._queue.qsize() >= 1

    # Phase 2: restart — recover from WAL and flush.
    wal2 = WriteAheadLog(wal_path)
    recovered = wal2.recover()
    assert len(recovered) >= 1

    pipeline2 = EventPipeline(live_cfg, client, wal2, str(tmp_path / "dlq2.json"))
    for event in recovered:
        pipeline2._queue.put_nowait(QueueItem(event=event))
    result = pipeline2.flush_now()
    assert result["sent"] >= 1
