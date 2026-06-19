import hashlib

import pytest
from app.database import Base, get_db
from app.main import app
from app.models.organization import Organization
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

SQLALCHEMY_DATABASE_URL = "sqlite://"

TEST_API_KEY = "am_test_key_for_ci"
TEST_API_KEY_HASH = hashlib.sha256(TEST_API_KEY.encode()).hexdigest()

# StaticPool ensures all engine.connect() calls share the same underlying
# SQLite connection, so tables created in setup_db are visible to every
# session used during the test (including those spawned by TestClient).
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def org(db):
    """Seed the default organization with a known test API key."""
    organization = Organization(
        email="test@example.com",
        company_name="Test Co",
        plan="free",
        sdk_key_hash=TEST_API_KEY_HASH,
    )
    db.add(organization)
    db.commit()
    db.refresh(organization)
    return organization


@pytest.fixture
def client(db, org):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, headers={"Authorization": f"Bearer {TEST_API_KEY}"}) as c:
        yield c
    app.dependency_overrides.clear()
