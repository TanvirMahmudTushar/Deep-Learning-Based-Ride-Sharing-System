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
PUBLIC_ROUTES = {"/api/auth/register", "/api/auth/login", "/api/auth/otp/request", "/api/auth/otp/verify", "/api/health", "/api/zones", "/api/models", "/api/brta"}
PASSENGER_PREFIXES = ("/api/trips", "/api/passenger", "/api/assistant")
RIDER_PREFIXES = ("/api/rider",)
ADMIN_PREFIXES = ("/api/admin",)
# All an approved support agent may reach under /api/admin. Adding a route here is a privacy decision.
SUPPORT_ROUTES = {
    ("GET", "/api/admin/trips/live"),
    ("GET", "/api/admin/trips/recent"),
    ("GET", "/api/admin/alerts"),
    ("POST", "/api/admin/alerts/x/escalate"),
    ("POST", "/api/admin/alerts/x/summarize"),
    ("POST", "/api/admin/alerts/x/status"),
    ("GET", "/api/admin/alerts/summary"),
    ("POST", "/api/admin/alerts/x/claim"),
    ("POST", "/api/admin/alerts/x/release"),
    ("POST", "/api/admin/alerts/x/notes"),
    ("GET", "/api/admin/trips/x"),
    ("GET", "/api/admin/trips/x/messages"),
    # Saved replies (#60): agents manage their own; team replies stay admin-only inside the route.
    ("GET", "/api/admin/saved-replies"),
    ("POST", "/api/admin/saved-replies"),
    ("PUT", "/api/admin/saved-replies/x"),
    ("DELETE", "/api/admin/saved-replies/x"),
}
CONDITIONALLY_RESTRICTED_SUPPORT_ROUTES = {("GET", "/api/admin/trips/x/messages")}


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


import itertools

from app.schemas import normalize_phone

_PHONE_SEQ = itertools.count(10000001)


def _next_phone() -> str:
    return f"+88017{next(_PHONE_SEQ)}"


def _register(client, email, password="a-good-password", **extra):
    body = {"full_name": "Auth Test", "email": email, "phone": _next_phone(), "password": password, "otp": "000000", **extra}
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


def test_rider_block_reasons_are_admin_only(client, user_h, rider_h, support_h, admin_h):
    path = "/api/admin/riders/not-a-rider/blocks"
    assert client.get(path).status_code == 401
    for headers in (user_h, rider_h, support_h):
        assert client.get(path, headers=headers).status_code == 403
    assert client.get(path, headers=admin_h).status_code == 404


def test_support_can_escalate_but_only_admin_can_resolve(client, support_h, admin_h):
    path = "/api/admin/alerts/not-an-alert"
    assert client.post(f"{path}/escalate", headers=support_h, json={"reason": "Needs admin review"}).status_code == 404
    assert client.post(f"{path}/escalation/resolve", headers=support_h, json={"note": "Handled"}).status_code == 403
    assert client.post(f"{path}/escalation/resolve", headers=admin_h, json={"note": "Handled"}).status_code == 404


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


def test_new_support_agent_has_access_straight_away_but_only_to_support_routes(client):
    body, agent = _support_signup(client, "new.agent@example.com")
    assert body["profile"]["role"] == "support"
    assert body["profile"]["approval_status"] == "approved"
    assert client.get("/api/auth/me", headers=agent).status_code == 200
    assert client.get("/api/admin/alerts", headers=agent).status_code == 200

    statuses = _call_all(client, PASSENGER_PREFIXES + RIDER_PREFIXES, agent)
    allowed = {route: code for route, code in statuses.items() if code != 403}
    assert not allowed, f"a support agent reached: {allowed}"


def test_support_agent_cannot_choose_their_own_status_or_use_admin_actions(client):
    body = {"full_name": "Sneaky", "email": "sneaky@example.com", "phone": _next_phone(), "password": "a-good-password", "otp": "000000"}
    created = client.post("/api/auth/register", json={**body, "role": "support", "approval_status": "revoked"}).json()
    assert created["profile"]["approval_status"] == "approved"  # the field is ignored; sign-up decides it
    agent = {"Authorization": f"Bearer {created['token']}"}
    assert client.post(f"/api/admin/support-agents/{created['profile']['id']}/revoke", headers=agent).status_code == 403
    assert client.post(f"/api/admin/support-agents/{created['profile']['id']}/approve", headers=agent).status_code == 403


def test_approved_support_agent_only_reaches_trips_and_alerts(client, support_h):
    statuses = _call_all(client, ADMIN_PREFIXES, support_h)
    assert SUPPORT_ROUTES <= set(statuses), "a support route was renamed; update SUPPORT_ROUTES"
    for route, code in statuses.items():
        if route in SUPPORT_ROUTES:
            if route in CONDITIONALLY_RESTRICTED_SUPPORT_ROUTES:
                assert code == 403, f"the placeholder trip has no alert, so access should be refused for {route}"
            else:
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


def test_admin_can_remove_and_restore_support_access(client, admin_h):
    body, agent = _support_signup(client, "lifecycle.agent@example.com")
    agent_id = body["profile"]["id"]

    listed = client.get("/api/admin/support-agents", headers=admin_h).json()
    assert next(a for a in listed if a["id"] == agent_id)["status"] == "approved"
    assert client.get("/api/admin/alerts", headers=agent).status_code == 200

    assert client.post(f"/api/admin/support-agents/{agent_id}/revoke", headers=admin_h).status_code == 200
    # The same token loses access straight away; there is no need to wait for it to expire.
    assert client.get("/api/admin/alerts", headers=agent).status_code == 403
    assert client.get("/api/admin/trips/live", headers=agent).status_code == 403

    restored = client.post(f"/api/admin/support-agents/{agent_id}/approve", headers=admin_h)
    assert restored.status_code == 200 and restored.json()["status"] == "approved"
    assert client.get("/api/admin/alerts", headers=agent).status_code == 200



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


# --- small input checks ----------------------------------------------------------------------


def _signup_body(**overrides) -> dict:
    return {"full_name": "Valid Name", "email": "valid@example.com", "phone": _next_phone(), "password": "a-good-password", "otp": "000000", **overrides}


@pytest.mark.parametrize("phone", ["abcdef", "12345", "+88-", "01712 34x678", "+" + "1" * 40])
def test_sign_up_rejects_phone_numbers_nobody_could_dial(client, phone):
    resp = client.post("/api/auth/register", json=_signup_body(email=f"bad.phone.{abs(hash(phone))}@example.com", phone=phone))
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("phone", ["+8801712345671", "01712345672", "+880 1712-345673"])
def test_sign_up_accepts_normal_phone_numbers(client, phone):
    resp = client.post("/api/auth/register", json=_signup_body(email=f"ok.phone.{abs(hash(phone))}@example.com", phone=phone))
    assert resp.status_code == 201, resp.text
    assert resp.json()["profile"]["phone"] == normalize_phone(phone)


def test_a_name_of_only_spaces_is_not_a_name(client, user_h):
    assert client.post("/api/auth/register", json=_signup_body(email="blank.name@example.com", full_name="    ")).status_code == 422
    assert client.patch("/api/auth/me", headers=user_h, json={"full_name": "   ", "phone": "+8801712345678"}).status_code == 422
    assert client.patch("/api/auth/me", headers=user_h, json={"full_name": "  Demo Passenger  ", "phone": "+8801712345678"}).json()["full_name"] == "Demo Passenger"


def test_history_lists_reject_nonsense_paging(client, user_h, rider_h):
    for path in ("/api/trips?limit=-1", "/api/trips?limit=0", "/api/trips?offset=-1", "/api/trips?limit=1000"):
        assert client.get(path, headers=user_h).status_code == 422, path
    assert client.get("/api/rider/trips?limit=-1", headers=rider_h).status_code == 422
    assert client.get("/api/rider/demand-hints?lat=999&lng=0", headers=rider_h).status_code == 422
    assert client.get("/api/trips?limit=5&offset=0", headers=user_h).status_code == 200


def test_new_password_has_to_differ_from_the_current_one(client):
    token = client.post("/api/auth/register", json=_signup_body(email="same.password@example.com")).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    same = client.post("/api/auth/password", headers=h, json={"current_password": "a-good-password", "new_password": "a-good-password"})
    assert same.status_code == 400 and "different" in same.json()["detail"]
    assert client.post("/api/auth/password", headers=h, json={"current_password": "a-good-password", "new_password": "another-good-one"}).status_code == 200


def test_registration_requires_valid_otp_and_normalizes_phone_uniqueness(client):
    # Missing or wrong OTP is rejected; 000000 succeeds.
    no_otp = _signup_body(email="no.otp@example.com")
    no_otp.pop("otp")
    assert client.post("/api/auth/register", json=no_otp).status_code == 400
    assert client.post("/api/auth/register", json=_signup_body(email="bad.otp@example.com", otp="123456")).status_code == 400

    # OtpRequestIn rejects invalid phone formats.
    assert client.post("/api/auth/otp/request", json={"email": "otp.bad@example.com", "phone": "not-a-phone"}).status_code == 422

    # Register with +8801755512345; equivalent local/dashed formats must be rejected as duplicates.
    ok = client.post("/api/auth/register", json=_signup_body(email="phone.norm1@example.com", phone="+8801755512345"))
    assert ok.status_code == 201, ok.text
    assert ok.json()["profile"]["phone"] == "+8801755512345"
    assert ok.json()["profile"]["phone_verified"] is True

    for dup_phone in ("01755512345", "+880 1755-512345", "8801755512345"):
        assert (
            client.post("/api/auth/otp/request", json={"email": "phone.dup@example.com", "phone": dup_phone}).status_code
            == 409
        )
        assert (
            client.post("/api/auth/register", json=_signup_body(email="phone.dup@example.com", phone=dup_phone)).status_code
            == 409
        )


def test_rider_registration_rejects_blank_vehicle_fields_and_duplicate_plates_and_emits_admin_event(client, monkeypatch):
    from sqlalchemy import delete, select
    from app.db import SessionLocal
    from app.models import Profile, Rider, Vehicle
    from app.realtime import ADMINS, hub

    events: list[tuple[list[str], dict]] = []
    orig_publish = hub.publish

    def spy(audience, message, *args, **kwargs):
        aud_list = list(audience)
        events.append((aud_list, message))
        return orig_publish(aud_list, message, *args, **kwargs)

    monkeypatch.setattr(hub, "publish", spy)

    base = _signup_body(
        email="rider.valid@example.com",
        role="rider",
        license_no="  DK-991  ",
        vehicle_type="bike",
        plate_no="  dhaka metro-ha 99-8877  ",
        vehicle_model="  Yamaha FZ  ",
    )

    # Whitespace-only vehicle/licence fields are rejected with 422.
    for field in ("license_no", "plate_no", "vehicle_model"):
        resp = client.post("/api/auth/register", json={**base, "email": f"blank.{field}@example.com", field: "   "})
        assert resp.status_code == 422, f"{field}: {resp.text}"

    # Valid rider registration succeeds and emits riders.changed to ADMINS.
    created = client.post("/api/auth/register", json=base)
    assert created.status_code == 201, created.text
    try:
        assert any(ADMINS in aud and msg.get("type") == "riders.changed" for aud, msg in events)

        # Duplicate active plate_no (even with different casing/spacing) is rejected with 409.
        dup_plate = _signup_body(
            email="rider.dup.plate@example.com",
            role="rider",
            license_no="DK-992",
            vehicle_type="bike",
            plate_no="DHAKA METRO-HA 99-8877",
            vehicle_model="Suzuki Gixxer",
        )
        dup_resp = client.post("/api/auth/register", json=dup_plate)
        assert dup_resp.status_code == 409, dup_resp.text
    finally:
        # Clean up created pending rider so downstream admin stats tests see the expected seeded count.
        with SessionLocal() as db:
            prof_id = created.json()["profile"]["id"]
            rider_id = db.scalar(select(Rider.id).where(Rider.profile_id == prof_id))
            db.execute(delete(Vehicle).where(Vehicle.rider_id == rider_id))
            db.execute(delete(Rider).where(Rider.id == rider_id))
            db.execute(delete(Profile).where(Profile.id == prof_id))
            db.commit()


def test_contact_and_profile_update_normalizes_and_enforces_phone_uniqueness(client, user_h, rider_h):
    other_phone = "+8801755599887"
    assert client.post("/api/auth/register", json=_signup_body(email="phone.owner@example.com", phone=other_phone)).status_code == 201

    # PATCH /api/auth/me rejects invalid and colliding normalized phones.
    assert client.patch("/api/auth/me", headers=user_h, json={"full_name": "Demo Passenger", "phone": "bad"}).status_code == 422
    assert client.patch("/api/auth/me", headers=user_h, json={"full_name": "Demo Passenger", "phone": "01755599887"}).status_code == 409

    # PATCH /api/rider/contact rejects invalid and colliding normalized phones, and normalizes valid updates.
    rider_me = client.get("/api/rider/me", headers=rider_h).json()
    assert client.patch("/api/rider/contact", headers=rider_h, json={"email": rider_me["email"], "phone": "bad"}).status_code == 422
    assert client.patch("/api/rider/contact", headers=rider_h, json={"email": rider_me["email"], "phone": "01755599887"}).status_code == 409

    updated = client.patch("/api/rider/contact", headers=rider_h, json={"email": rider_me["email"], "phone": "01755 599888"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["phone"] == "+8801755599888"

    # Restore original rider phone so downstream tests see the seeded value.
    assert client.patch("/api/rider/contact", headers=rider_h, json={"email": rider_me["email"], "phone": rider_me["phone"]}).status_code == 200
