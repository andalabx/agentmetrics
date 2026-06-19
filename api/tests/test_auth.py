def test_me_returns_org(client):
    res = client.get("/v1/auth/me")
    assert res.status_code == 200
    data = res.json()
    assert data["email"] == "test@example.com"
    assert data["company_name"] == "Test Co"


def test_update_company_name(client):
    res = client.patch("/v1/auth/me", json={"company_name": "Updated Co"})
    assert res.status_code == 200
    assert res.json()["company_name"] == "Updated Co"


def test_update_slack_webhook(client):
    webhook = "https://hooks.slack.com/services/T00/B00/xxx"
    res = client.patch("/v1/auth/me", json={"slack_webhook": webhook})
    assert res.status_code == 200
    assert res.json()["slack_webhook"] == webhook


def test_me_deleted_org_returns_401(client, db):
    from app.models.organization import Organization

    db.query(Organization).delete()
    db.commit()
    res = client.get("/v1/auth/me")
    # After org is deleted the key hash no longer matches any org → 401
    assert res.status_code == 401
