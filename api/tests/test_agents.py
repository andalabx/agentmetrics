import uuid


def _send_event(client, agent_id="test_agent", status="success", cost=0.01):
    client.post(
        "/v1/events",
        json={
            "trace_id": str(uuid.uuid4()),
            "agent_id": agent_id,
            "status": status,
            "cost_usd": cost,
            "duration_ms": 500,
        },
    )


def test_list_agents_empty(client):
    res = client.get("/v1/agents")
    assert res.status_code == 200
    assert res.json() == []


def test_list_agents_after_events(client):
    _send_event(client, "agent_a", "success", 0.005)
    _send_event(client, "agent_a", "success", 0.005)
    _send_event(client, "agent_a", "failed", 0.0)
    _send_event(client, "agent_b", "success", 0.01)

    res = client.get("/v1/agents")
    assert res.status_code == 200
    agents = {a["agent_id"]: a for a in res.json()}

    assert "agent_a" in agents
    assert agents["agent_a"]["total_calls"] == 3
    assert agents["agent_a"]["failed"] == 1
    assert round(agents["agent_a"]["total_cost"], 4) == 0.01

    assert "agent_b" in agents


def test_get_agent_detail(client):
    for _ in range(5):
        _send_event(client, "detail_agent", "success", 0.002)

    res = client.get("/v1/agents/detail_agent")
    assert res.status_code == 200
    data = res.json()
    assert data["agent_id"] == "detail_agent"
    assert data["total_calls"] == 5
    assert data["success_rate"] == 100.0
    assert "recent_runs" in data
    assert "cost_by_day" in data


def test_get_agent_not_found(client):
    res = client.get("/v1/agents/nonexistent")
    assert res.status_code == 404


def test_recommendations(client):
    res = client.get("/v1/recommendations")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
