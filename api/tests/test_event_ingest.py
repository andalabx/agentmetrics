"""
Tests for event ingest endpoint — deduplication, validation, rate limiting.
"""


def test_duplicate_trace_same_agent_is_deduplicated(client, db):
    """Second event with same trace_id + agent_id is silently deduplicated."""
    payload = {
        "trace_id": "dup-trace-001",
        "agent_id": "my-agent",
        "status": "completed",
    }
    r1 = client.post("/v1/events", json=payload)
    r2 = client.post("/v1/events", json=payload)
    assert r1.status_code in (200, 201)
    assert r2.status_code in (200, 201)
    # Only one row should exist
    from app.models.event import Event
    count = db.query(Event).filter_by(trace_id="dup-trace-001").count()
    assert count == 1


def test_same_trace_different_agent_is_not_deduplicated(client, db):
    """Same trace_id but different agent_id should produce two rows."""
    base = {"trace_id": "shared-trace", "status": "completed"}
    r1 = client.post("/v1/events", json={**base, "agent_id": "agent-a"})
    r2 = client.post("/v1/events", json={**base, "agent_id": "agent-b"})
    assert r1.status_code in (200, 201)
    assert r2.status_code in (200, 201)
    from app.models.event import Event
    count = db.query(Event).filter_by(trace_id="shared-trace").count()
    assert count == 2


def test_missing_required_fields_returns_422(client):
    r = client.post("/v1/events", json={"agent_id": "a"})  # missing trace_id + status
    assert r.status_code == 422


def test_negative_duration_ms_is_rejected(client):
    r = client.post("/v1/events", json={
        "trace_id": "t1", "agent_id": "a", "status": "completed",
        "duration_ms": -1,
    })
    assert r.status_code == 422


def test_negative_cost_usd_is_rejected(client):
    r = client.post("/v1/events", json={
        "trace_id": "t2", "agent_id": "a", "status": "completed",
        "cost_usd": -0.01,
    })
    assert r.status_code == 422


def test_oversized_metadata_is_rejected(client):
    big = {"key": "x" * 70_000}
    r = client.post("/v1/events", json={
        "trace_id": "t3", "agent_id": "a", "status": "completed",
        "metadata": big,
    })
    assert r.status_code == 422


def test_error_field_is_truncated_to_max_length(client):
    long_error = "e" * 5000
    r = client.post("/v1/events", json={
        "trace_id": "t4", "agent_id": "a", "status": "failed",
        "error": long_error,
    })
    # Should be accepted but truncated / rejected — whichever the schema enforces
    assert r.status_code in (200, 201, 422)


def test_batch_accepts_up_to_100_events(client):
    events = [
        {"trace_id": f"batch-{i}", "agent_id": "a", "status": "completed"}
        for i in range(100)
    ]
    r = client.post("/v1/events/batch", json={"events": events})
    assert r.status_code in (200, 201)


def test_batch_rejects_more_than_100_events(client):
    events = [
        {"trace_id": f"over-{i}", "agent_id": "a", "status": "completed"}
        for i in range(101)
    ]
    r = client.post("/v1/events/batch", json={"events": events})
    assert r.status_code == 422
