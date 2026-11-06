import threading
from datetime import timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db import SessionLocal, utcnow
from app.models import Profile, Rider, SafetyAlert, Trip
from app.realtime import hub
from app.services.documents import placeholder_png

GULSHAN = {"lat": 23.7810, "lng": 90.4150}
DHANMONDI = {"lat": 23.7465, "lng": 90.3745}


def _only_demo_rider_online():
    with SessionLocal() as db:
        db.execute(update(Rider).where(Rider.is_simulated.is_(True)).values(is_online=False))
        db.commit()


def _receive(ws, timeout: float = 5.0) -> dict:
    """ws.receive_json with a timeout, so a missing event fails the test instead of hanging it."""
    box: dict = {}
    t = threading.Thread(target=lambda: box.setdefault("msg", ws.receive_json()), daemon=True)
    t.start()
    t.join(timeout)
    assert "msg" in box, "no websocket message within timeout"
    return box["msg"]


@pytest.fixture
def captured(monkeypatch):
    """Record what would be published, without needing open sockets."""
    events: list[tuple[list, dict]] = []
    original = hub.publish

    def spy(audience, message, coalesce=None, interval=2.0):
        events.append((list(audience), message))
        original(audience, message, coalesce=coalesce, interval=interval)

    monkeypatch.setattr(hub, "publish", spy)
    return events


def _token(h: dict) -> str:
    return h["Authorization"].split(" ", 1)[1]


def test_websocket_requires_auth(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": "not-a-token"})
        with pytest.raises(Exception):
            ws.receive_json()


def test_offer_is_pushed_to_rider_socket(client, user_h, rider_h):
    _only_demo_rider_online()
    client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7815, "lng": 90.4140})
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": _token(rider_h)})
        assert _receive(ws)["type"] == "ready"
        ws.send_text("ping")
        assert _receive(ws)["type"] == "pong"

        trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
        msg = _receive(ws)
        assert msg["type"] == "offer.new" and msg["trip_id"] == trip["id"]
        assert msg["notify"]["title"] == "New trip request"
    client.post(f"/api/trips/{trip['id']}/cancel", headers=user_h)


def test_events_follow_the_trip_and_wait_for_commit(client, user_h, rider_h, captured):
    _only_demo_rider_online()
    client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7815, "lng": 90.4140})
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    client.post(f"/api/rider/offers/{trip['id']}/accept", headers=rider_h)

    with SessionLocal() as db:
        passenger = db.scalar(select(Profile).where(Profile.email == "user@ride.local"))
        rider_profile = db.scalar(select(Profile).where(Profile.email == "rider@ride.local"))
    types_for = lambda pid: [m["type"] for aud, m in captured if pid in aud]  # noqa: E731
    assert "offer.new" in types_for(rider_profile.id)
    accepted = [m for aud, m in captured if passenger.id in aud and m.get("status") == "accepted"]
    assert accepted and accepted[0]["notify"]["title"] == "Rider on the way"

    # Arrival: a GPS fix within the arrival radius of the pickup notifies the passenger once.
    captured.clear()
    client.post("/api/rider/location", headers=rider_h, json={**GULSHAN, "accuracy_m": 10})
    arrived = [m for aud, m in captured if passenger.id in aud and m.get("notify", {}).get("title") == "Your rider has arrived"]
    assert len(arrived) == 1
    assert client.get(f"/api/trips/{trip['id']}", headers=user_h).json()["arrived_at"]

    # A rolled-back transaction sends nothing.
    captured.clear()
    with SessionLocal() as db:
        from app.realtime import emit

        emit(db, passenger.id, "trip.updated", trip_id="x")
        db.rollback()
    assert captured == []

    client.post(f"/api/rider/trips/{trip['id']}/cancel", headers=rider_h)


def test_inaccurate_gps_does_not_raise_alerts(client, user_h, rider_h):
    _only_demo_rider_online()
    client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7815, "lng": 90.4140})
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    client.post(f"/api/rider/offers/{trip['id']}/accept", headers=rider_h)
    client.post(f"/api/rider/trips/{trip['id']}/start", headers=rider_h)
    # 3 km off route, but the fix claims 500 m accuracy: stored, not alerted.
    client.post("/api/rider/location", headers=rider_h, json={"lat": 23.80, "lng": 90.36, "speed_kmh": 20, "accuracy_m": 500})
    with SessionLocal() as db:
        assert db.scalar(select(SafetyAlert.id).where(SafetyAlert.trip_id == trip["id"])) is None
    done = client.post(f"/api/rider/trips/{trip['id']}/complete", headers=rider_h).json()
    assert done["payment"]["status"] == "pending"
    assert done["passenger_phone"] is None  # only shared while the trip is in progress


def test_stale_rider_gets_no_offers(client, user_h, rider_h):
    _only_demo_rider_online()
    client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7815, "lng": 90.4140})
    with SessionLocal() as db:
        db.execute(update(Rider).where(Rider.is_simulated.is_(False)).values(last_seen=utcnow() - timedelta(minutes=10)))
        db.commit()
    resp = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"})
    assert resp.status_code == 409
    # A fresh GPS fix makes the rider available again.
    client.post("/api/rider/location", headers=rider_h, json={"lat": 23.7815, "lng": 90.4140})
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"})
    assert trip.status_code == 201
    client.post(f"/api/trips/{trip.json()['id']}/cancel", headers=user_h)


def test_document_upload_review_and_access(client, admin_h, rider_h):
    reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "Doc Rider", "email": "doc.rider@example.com", "phone": "+8801733333333", "password": "secret1",
            "role": "rider", "license_no": "DK-77", "vehicle_type": "bike", "plate_no": "DHAKA METRO-HA 11-2222", "vehicle_model": "Yamaha FZ",
        },
    ).json()
    h = {"Authorization": f"Bearer {reg['token']}"}
    overview = client.get("/api/rider/documents", headers=h).json()
    assert not overview["ready"] and len(overview["missing"]) == 3

    png = placeholder_png("licence")
    bad = client.post("/api/rider/documents", headers=h, data={"doc_type": "license"}, files={"file": ("fake.png", b"not an image", "image/png")})
    assert bad.status_code == 422
    wrong_type = client.post("/api/rider/documents", headers=h, data={"doc_type": "license"}, files={"file": ("x.txt", b"hello", "text/plain")})
    assert wrong_type.status_code == 422

    ids = {}
    for doc_type in ("license", "registration", "photo"):
        r = client.post("/api/rider/documents", headers=h, data={"doc_type": doc_type}, files={"file": (f"{doc_type}.png", png, "image/png")})
        assert r.status_code == 201, r.text
        ids[doc_type] = r.json()["id"]

    assert client.get(f"/api/documents/{ids['license']}/file", headers=h).content == png  # owner
    assert client.get(f"/api/documents/{ids['license']}/file", headers=admin_h).status_code == 200  # admin
    assert client.get(f"/api/documents/{ids['license']}/file", headers=rider_h).status_code == 404  # another rider

    assert client.post(f"/api/admin/documents/{ids['photo']}/review", headers=admin_h, json={"status": "rejected"}).status_code == 422
    client.post(f"/api/admin/documents/{ids['photo']}/review", headers=admin_h, json={"status": "rejected", "note": "Face not visible"})
    after = client.get("/api/rider/documents", headers=h).json()
    photo = next(d for d in after["required"] if d["doc_type"] == "photo")["document"]
    assert photo["status"] == "rejected" and photo["review_note"] == "Face not visible"

    # Re-upload replaces the rejected version.
    new = client.post("/api/rider/documents", headers=h, data={"doc_type": "photo"}, files={"file": ("p2.png", png, "image/png")}).json()
    for doc_id in (ids["license"], ids["registration"], new["id"]):
        client.post(f"/api/admin/documents/{doc_id}/review", headers=admin_h, json={"status": "approved"})
    assert client.get("/api/rider/me", headers=h).json()["documents_ready"] is True


def test_settlement_reduces_commission_due(client, admin_h, rider_h):
    before = client.get("/api/rider/earnings", headers=rider_h).json()["balance"]
    assert before["commission_due"] > 0
    rider_id = client.get("/api/rider/me", headers=rider_h).json()["id"]
    resp = client.post(f"/api/admin/riders/{rider_id}/settlements", headers=admin_h, json={"amount": before["commission_due"], "note": "bKash"})
    assert resp.status_code == 201
    after = client.get("/api/rider/earnings", headers=rider_h).json()
    assert after["balance"]["commission_due"] == 0 and after["settlements"][0]["note"] == "bKash"
    overview = client.get("/api/admin/payments", headers=admin_h).json()
    assert overview["month"]["gross"] > 0 and any(b["rider_id"] == rider_id for b in overview["balances"])


def test_fare_report_disputes_pending_payment(client, user_h, rider_h):
    _only_demo_rider_online()
    client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7815, "lng": 90.4140})
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    client.post(f"/api/rider/offers/{trip['id']}/accept", headers=rider_h)
    client.post(f"/api/rider/trips/{trip['id']}/start", headers=rider_h)
    client.post(f"/api/rider/trips/{trip['id']}/complete", headers=rider_h)
    client.post(f"/api/trips/{trip['id']}/report", headers=user_h, json={"category": "fare", "note": "Rider asked for more than the fare"})
    assert client.get(f"/api/trips/{trip['id']}", headers=user_h).json()["payment"]["status"] == "disputed"


def test_geocoding_falls_back_to_zones_when_disabled(client, user_h):
    assert client.get("/api/geo/search", headers=user_h, params={"q": "Gulshan 2"}).json() == []
    assert client.get("/api/geo/reverse", headers=user_h, params=GULSHAN).json()["label"] == "Near Gulshan"
    assert client.get("/api/geo/search", params={"q": "Gulshan"}).status_code == 401


def test_real_mode_bootstrap(tmp_path, monkeypatch):
    from sqlalchemy import create_engine

    from app import db as dbmod
    from app import seed
    from app.config import settings
    from app.models import PricingRule, Zone

    engine = create_engine(f"sqlite:///{(tmp_path / 'real.db').as_posix()}")
    monkeypatch.setattr(dbmod, "engine", engine)
    dbmod.create_schema()
    with Session(engine) as db:
        monkeypatch.setattr(settings, "admin_email", None)
        assert seed.ensure_admin(db) is None  # nothing to create from
        seed.seed_reference(db)
        monkeypatch.setattr(settings, "admin_email", "Boss@Example.com")
        monkeypatch.setattr(settings, "admin_password", "a-strong-password")
        assert seed.ensure_admin(db) == "boss@example.com"
        assert seed.ensure_admin(db) is None  # only the first time
        assert len(db.scalars(select(Zone)).all()) == 12
        assert {r.vehicle_type: r.commission_pct for r in db.scalars(select(PricingRule))} == {"bike": 15, "cng": 12, "car": 18}
        assert db.scalar(select(Profile).where(Profile.email == "user@ride.local")) is None  # no demo accounts
        assert db.scalar(select(Trip.id)) is None


def test_pending_payment_survives_reload(client, user_h, rider_h):
    _only_demo_rider_online()
    client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7815, "lng": 90.4140})
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    client.post(f"/api/rider/offers/{trip['id']}/accept", headers=rider_h)
    client.post(f"/api/rider/trips/{trip['id']}/start", headers=rider_h)
    client.post(f"/api/rider/trips/{trip['id']}/complete", headers=rider_h)
    assert client.get("/api/rider/active", headers=rider_h).json() is None
    pending = client.get("/api/rider/pending-payment", headers=rider_h).json()
    assert pending["id"] == trip["id"] and pending["payment"]["status"] == "pending"
    client.post(f"/api/rider/trips/{trip['id']}/collect", headers=rider_h)
    following = client.get("/api/rider/pending-payment", headers=rider_h).json()
    assert following is None or following["id"] != trip["id"]  # older uncollected trips may remain
