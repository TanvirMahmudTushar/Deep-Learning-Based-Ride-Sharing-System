import os
import tempfile
from pathlib import Path

# Configure before the app (and its settings) are imported: isolated DB, no network, no background loop.
_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ.update(
    DATABASE_URL=f"sqlite:///{_tmp.as_posix()}",
    DEMO_MODE="true",
    RUN_SIMULATOR="false",
    USE_GEOCODING="false",
    UPLOAD_DIR=str(_tmp.parent / "uploads"),
    USE_OSRM="false",
    USE_WEATHER="false",
    GROQ_API_KEY="",
    SIMULATOR_ANOMALY_RATE="0",
    # Ignore a developer's backend/.env: no bootstrap admin, fixed signing key.
    ADMIN_EMAIL="",
    ADMIN_PASSWORD="",
    JWT_SECRET="test-secret-key-that-is-long-enough-for-hs256",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login(client: TestClient, email: str, password: str) -> dict:
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture(scope="session")
def user_h(client):
    return login(client, "user@ride.local", "user123")


@pytest.fixture(scope="session")
def rider_h(client):
    return login(client, "rider@ride.local", "rider123")


@pytest.fixture(scope="session")
def admin_h(client):
    return login(client, "admin@ride.local", "admin123")
