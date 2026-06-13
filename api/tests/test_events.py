def test_ingest_event_success(client):
    res = client.post(
        "/v1/events",
        json={
            "trace_id": "trace-001",
            "agent_id": "my_agent",
            "status": "success",
            "duration_ms": 1200.0,
            "cost_usd": 0.002,
        },
    )
    assert res.status_code == 201
    assert res.json()["status"] == "accepted"


def test_ingest_event_with_tokens(client):
    """Cost is recalculated server-side when token counts are provided."""
    res = client.post(
        "/v1/events",
        json={
            "trace_id": "trace-002",
            "agent_id": "my_agent",
            "status": "success",
            "model": "gpt-4o-mini",
            "input_tokens": 1000,
            "output_tokens": 500,
            "cost_usd": 0.0,
        },
    )
    assert res.status_code == 201


def test_ingest_event_failed_status(client):
    res = client.post(
        "/v1/events",
        json={
            "trace_id": "trace-003",
            "agent_id": "my_agent",
            "status": "failed",
            "error": "TimeoutError: LLM did not respond",
        },
    )
    assert res.status_code == 201


def test_ingest_event_duplicate_trace_id_deduplicated(client):
    """A second event with the same trace_id is silently dropped."""
    payload = {"trace_id": "trace-dup", "agent_id": "a", "status": "success"}
    client.post("/v1/events", json=payload)
    res = client.post("/v1/events", json=payload)
    assert res.status_code == 201
