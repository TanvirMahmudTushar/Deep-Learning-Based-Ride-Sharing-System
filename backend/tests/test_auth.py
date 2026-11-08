"""Authentication and role-based access for passengers, riders and admins."""

import re
from datetime import timedelta

import jwt
import pytest

from app.config import Settings, settings
from app.db import utcnow
from app.main import app
from app.services import login_throttle

from .conftest import login

# Everything else under /api must demand a login, so a new route without a guard fails these tests.
PUBLIC_ROUTES = {"/api/auth/register", "/api/auth/login", "/api/health", "/api/zones", "/api/models"}
PASSENGER_PREFIXES = ("/api/trips", "/api/passenger", "/api/assistant")
RIDER_PREFIXES = ("/api/rider",)
ADMIN_PREFIXES = ("/api/admin",)
# All an approved support agent may reach under /api/admin. Adding a route here is a privacy decision.
SUPPORT_ROUTES = {
    ("GET", "/api/admin/trips/live"),
    ("GET", "/api/admin/trips/recent"),
    ("GET", "/api/admin/alerts"),
    ("POST", "/api/admin/alerts/x/summarize"),
    ("POST", "/api/admin/alerts/x/status"),
    ("GET", "/api/admin/alerts/summary"),
    ("POST", "/api/admin/alerts/x/claim"),
    ("POST", "/api/admin/alerts/x/release"),
    ("POST", "/api/admin/alerts/x/notes"),
    ("GET", "/api/admin/trips/x"),
}


def _api_routes():
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/api"):
            for method in operations:
                yield method.upper(), re.sub(r"\{[^}]+\}", "x", path), path


def _call_all(client, prefixes, headers):
    """Status of every route under the given prefixes."""
    routes = [(m, url) for m, url, _ in _api_routes() if url.startswith(prefixes)]
    assert routes, f"no routes found under {prefixes}"
    return {(m, url): client.request(m, url, headers=headers).status_code for m, url in routes}


def _register(client, email, password="a-good-password", **extra):
    body = {"full_name": "Auth Test", "email": email, "phone": "+8801711111111", "password": password, **extra}
    return client.post("/api/auth/register", json=body)


@pytest.fixture(autouse=True)
def fresh_throttle():
    login_throttle.reset()
    yield
    login_throttle.reset()


def test_every_private_route_rejects_anonymous_requests(client):
    checked = 0
    for method, url, path in _api_routes():
        if path in PUBLIC_ROUTES:
            continue
        assert client.request(method, url).status_code == 401, f"{method} {path} is reachable without logging in"
        checked += 1
    assert checked > 50


@pytest.mark.parametrize(
    ("prefixes", "other_roles"),
    [
        (PASSENGER_PREFIXES, ("rider_h", "admin_h")),
        (RIDER_PREFIXES, ("user_h", "admin_h")),
        (ADMIN_PREFIXES, ("user_h", "rider_h")),
    ],
)
def test_each_portal_rejects_the_other_two_roles(client, request, prefixes, other_roles):
    for fixture in other_roles:
        statuses = _call_all(client, prefixes, request.getfixturevalue(fixture))
        wrong = {route: code for route, code in statuses.items() if code != 403}
        assert not wrong, f"{fixture} was not refused: {wrong}"


def test_each_role_can_open_its_own_portal(client, user_h, rider_h, admin_h):
    assert client.get("/api/trips/active", headers=user_h).status_code == 200
    assert client.get("/api/rider/me", headers=rider_h).status_code == 200
    assert client.get("/api/admin/stats", headers=admin_h).status_code == 200


def test_nobody_can_sign_up_as_admin(client):
    assert _register(client, "wannabe@example.com", role="admin").status_code == 422


def test_login_returns_the_real_role_for_all_three(client):
    for email, password, role in [
        ("user@ride.local", "user123", "user"),
        ("rider@ride.local", "rider123", "rider"),
        ("admin@ride.local", "admin123", "admin"),
    ]:
        body = client.post("/api/auth/login", json={"email": email, "password": password}).json()
        assert body["profile"]["role"] == role


def test_forged_and_expired_tokens_are_rejected(client, user_h):
    good = jwt.decode(user_h["Authorization"].split()[1], settings.jwt_secret, algorithms=["HS256"])

    forged = jwt.encode({**good, "role": "admin"}, "not-the-real-secret-not-the-real-secret", algorithm="HS256")
    assert client.get("/api/admin/stats", headers={"Authorization": f"Bearer {forged}"}).status_code == 401

    expired = jwt.encode({**good, "exp": utcnow() - timedelta(minutes=1)}, settings.jwt_secret, algorithm="HS256")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401

    no_alg = jwt.encode(good, None, algorithm="none")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {no_alg}"}).status_code == 401


def test_role_comes_from_the_database_not_the_token(client, user_h):
    """Even a validly signed token can't claim a role the account doesn't have."""
    claims = jwt.decode(user_h["Authorization"].split()[1], settings.jwt_secret, algorithms=["HS256"])
    promoted = jwt.encode({**claims, "role": "admin"}, settings.jwt_secret, algorithm="HS256")
    assert client.get("/api/admin/stats", headers={"Authorization": f"Bearer {promoted}"}).status_code == 403


def test_changing_password_signs_out_older_tokens(client):
    old_token = _register(client, "change.pw@example.com").json()["token"]
    old = {"Authorization": f"Bearer {old_token}"}
    assert client.get("/api/auth/me", headers=old).status_code == 200

    resp = client.post("/api/auth/password", headers=old, json={"current_password": "a-good-password", "new_password": "another-good-one"})
    assert resp.status_code == 200, resp.text

    assert client.get("/api/auth/me", headers=old).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {resp.json()['token']}"}).status_code == 200
    login(client, "change.pw@example.com", "another-good-one")


def test_repeated_failed_logins_are_locked_out(client):
    _register(client, "locked@example.com")
    attempt = {"email": "locked@example.com", "password": "wrong-password"}
    for _ in range(settings.login_max_failures):
        assert client.post("/api/auth/login", json=attempt).status_code == 401

    blocked = client.post("/api/auth/login", json={**attempt, "password": "a-good-password"})
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    # Spelling the email differently doesn't dodge the lock, and other accounts aren't affected.
    assert client.post("/api/auth/login", json={**attempt, "email": " LOCKED@example.com "}).status_code == 429
    login(client, "user@ride.local", "user123")


def test_lockout_ends_after_the_window(client, monkeypatch):
    _register(client, "waits@example.com")
    for _ in range(settings.login_max_failures):
        client.post("/api/auth/login", json={"email": "waits@example.com", "password": "wrong-password"})

    assert client.post("/api/auth/login", json={"email": "waits@example.com", "password": "a-good-password"}).status_code == 429
    later = login_throttle._now() + settings.login_lockout_minutes * 60 + 1
    monkeypatch.setattr(login_throttle, "_now", lambda: later)
    login(client, "waits@example.com", "a-good-password")


def test_successful_login_resets_the_failure_count(client):
    _register(client, "forgetful@example.com")
    for _ in range(3):
        for _ in range(settings.login_max_failures - 1):
            client.post("/api/auth/login", json={"email": "forgetful@example.com", "password": "wrong-password"})
        login(client, "forgetful@example.com", "a-good-password")


def test_password_rules(client):
    assert _register(client, "short@example.com", password="1234567").status_code == 422
    # 72 characters but 144 bytes: too long for bcrypt, which must be a clean error rather than a crash.
    long = _register(client, "long@example.com", password="é" * 72)
    assert long.status_code == 422
    assert "too long" in long.json()["detail"][0]["msg"]
    assert _register(client, "spaces@example.com", password="  has spaces  ").status_code == 201
    login(client, "spaces@example.com", "  has spaces  ")


def test_blank_or_published_jwt_secret_is_never_used():
    published = "dev-only-secret-change-me-in-production-0000"
    for value in ("", published):
        generated = Settings(_env_file=None, jwt_secret=value)
        assert generated.jwt_secret_generated
        assert generated.jwt_secret not in ("", published)
        assert len(generated.jwt_secret) >= 32

    mine = "a-long-random-secret-from-the-environment-file"
    explicit = Settings(_env_file=None, jwt_secret=mine)
    assert explicit.jwt_secret == mine
    assert not explicit.jwt_secret_generated


def _support_signup(client, email):
    body = _register(client, email, role="support").json()
    return body, {"Authorization": f"Bearer {body['token']}"}


def test_new_support_agent_sees_nothing_until_approved(client):
    body, agent = _support_signup(client, "new.agent@example.com")
    assert body["profile"]["role"] == "support"
    assert body["profile"]["approval_status"] == "pending"
    assert client.get("/api/auth/me", headers=agent).status_code == 200

    statuses = _call_all(client, PASSENGER_PREFIXES + RIDER_PREFIXES + ADMIN_PREFIXES, agent)
    allowed = {route: code for route, code in statuses.items() if code != 403}
    assert not allowed, f"a pending support agent reached: {allowed}"


def test_support_agent_cannot_approve_themselves(client):
    body = {"full_name": "Sneaky", "email": "sneaky@example.com", "phone": "+8801711111111", "password": "a-good-password"}
    created = client.post("/api/auth/register", json={**body, "role": "support", "approval_status": "approved"}).json()
    assert created["profile"]["approval_status"] == "pending"
    agent = {"Authorization": f"Bearer {created['token']}"}
    assert client.post(f"/api/admin/support-agents/{created['profile']['id']}/approve", headers=agent).status_code == 403
    assert client.get("/api/admin/alerts", headers=agent).status_code == 403


def test_approved_support_agent_only_reaches_trips_and_alerts(client, support_h):
    statuses = _call_all(client, ADMIN_PREFIXES, support_h)
    assert SUPPORT_ROUTES <= set(statuses), "a support route was renamed; update SUPPORT_ROUTES"
    for route, code in statuses.items():
        if route in SUPPORT_ROUTES:
            assert code != 403, f"support should reach {route}"
        else:
            assert code == 403, f"support should not reach {route}, got {code}"
    for prefixes in (PASSENGER_PREFIXES, RIDER_PREFIXES):
        wrong = {route: code for route, code in _call_all(client, prefixes, support_h).items() if code != 403}
        assert not wrong, f"support reached: {wrong}"


def test_support_agent_cannot_open_rider_documents(client, support_h, admin_h):
    riders = client.get("/api/admin/riders", headers=admin_h).json()
    rider = next(r for r in riders if r["email"] == "pending@ride.local")
    overview = client.get(f"/api/admin/riders/{rider['id']}/documents", headers=admin_h).json()
    doc_id = overview["required"][0]["document"]["id"]
    assert client.get(f"/api/documents/{doc_id}/file", headers=admin_h).status_code == 200
    assert client.get(f"/api/documents/{doc_id}/file", headers=support_h).status_code == 404


def test_admin_approves_and_revokes_support_access(client, admin_h):
    body, agent = _support_signup(client, "lifecycle.agent@example.com")
    agent_id = body["profile"]["id"]

    listed = client.get("/api/admin/support-agents", headers=admin_h).json()
    assert next(a for a in listed if a["id"] == agent_id)["status"] == "pending"
    assert client.get("/api/admin/stats", headers=admin_h).json()["pending_support"] >= 1

    approved = client.post(f"/api/admin/support-agents/{agent_id}/approve", headers=admin_h)
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    assert client.get("/api/admin/alerts", headers=agent).status_code == 200
    assert client.get("/api/auth/me", headers=agent).json()["approval_status"] == "approved"

    assert client.post(f"/api/admin/support-agents/{agent_id}/revoke", headers=admin_h).status_code == 200
    # The same token loses access straight away; there is no need to wait for it to expire.
    assert client.get("/api/admin/alerts", headers=agent).status_code == 403
    assert client.get("/api/admin/trips/live", headers=agent).status_code == 403


def test_only_support_accounts_can_be_approved(client, admin_h):
    rider_id = client.get("/api/admin/riders", headers=admin_h).json()[0]["id"]
    assert client.post(f"/api/admin/support-agents/{rider_id}/approve", headers=admin_h).status_code == 404
    assert client.post("/api/admin/support-agents/not-a-real-id/approve", headers=admin_h).status_code == 404


def test_support_agent_can_work_an_alert(client, support_h, user_h, admin_h):
    trips = client.get("/api/trips", headers=user_h).json()
    assert trips, "demo passenger should have past trips"
    finished = next(t for t in trips if t["status"] in ("completed", "cancelled"))
    report = {"category": "other", "note": "Left my umbrella behind"}
    assert client.post(f"/api/trips/{finished['id']}/report", headers=user_h, json=report).status_code == 201

    alert = next(a for a in client.get("/api/admin/alerts", headers=support_h).json() if a["trip_id"] == finished["id"])
    resp = client.post(f"/api/admin/alerts/{alert['id']}/status", headers=support_h, json={"status": "reviewed"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "reviewed"
