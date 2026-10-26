from datetime import timedelta

from sqlalchemy import select, update

from app.config import settings
from app.db import SessionLocal
from app.models import Rider, SafetyAlert, Trip
from app.services import simulator

GULSHAN = {"lat": 23.7810, "lng": 90.4150}
DHANMONDI = {"lat": 23.7465, "lng": 90.3745}


def _run_simulator(ticks: int) -> None:
    with SessionLocal() as db:
        for _ in range(ticks):
            simulator.tick(db)


def test_health_and_zones(client):
    assert client.get("/api/health").json()["status"] == "ok"
    assert len(client.get("/api/zones").json()) == 12
    assert {m["component"] for m in client.get("/api/models").json()} == {"demand", "eta", "cancellation", "anomaly"}


def test_roles_are_enforced(client, user_h, rider_h):
    assert client.get("/api/admin/stats", headers=user_h).status_code == 403
    assert client.get("/api/rider/me", headers=user_h).status_code == 403
    assert client.post("/api/trips/estimate", headers=rider_h, json={"pickup": GULSHAN, "drop": DHANMONDI}).status_code == 403
    assert client.get("/api/trips/active").status_code == 401


def test_estimate_returns_quote_per_vehicle(client, user_h):
    resp = client.post("/api/trips/estimate", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [q["vehicle_type"] for q in body["quotes"]] == ["bike", "cng", "car"]
    fares = {q["vehicle_type"]: q["fare"] for q in body["quotes"]}
    assert fares["bike"] < fares["cng"] < fares["car"]
    assert all(q["reason"] for q in body["quotes"])
    assert body["pickup_address"] == "Near Gulshan"


def test_simulated_trip_runs_to_completion(client, user_h, monkeypatch):
    monkeypatch.setattr(settings, "simulator_accept_delay_seconds", 0)
    monkeypatch.setattr(settings, "simulator_speedup", 2000)

    resp = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"})
    assert resp.status_code == 201, resp.text
    trip_id = resp.json()["id"]
    assert resp.json()["status"] == "requested"

    # A second booking while one is active is refused.
    again = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"})
    assert again.status_code == 409

    _run_simulator(1)
    active = client.get("/api/trips/active", headers=user_h).json()
    assert active["status"] in ("accepted", "ongoing")
    assert active["rider"]["vehicle"]["vehicle_type"] == "bike"

    _run_simulator(30)
    trip = client.get(f"/api/trips/{trip_id}", headers=user_h).json()
    assert trip["status"] == "completed"
    assert trip["fare_final"] == trip["fare_estimate"]
    assert client.get("/api/trips/active", headers=user_h).json() is None

    rated = client.post(f"/api/trips/{trip_id}/rate", headers=user_h, json={"stars": 5, "comment": "Smooth ride"})
    assert rated.status_code == 200 and rated.json()["rating"] == 5
    assert client.post(f"/api/trips/{trip_id}/rate", headers=user_h, json={"stars": 4}).status_code == 409


def test_manual_rider_flow_with_deviation_alert(client, user_h, rider_h, admin_h):
    # Take simulated bike riders offline so the demo rider is the only candidate.
    with SessionLocal() as db:
        db.execute(update(Rider).where(Rider.is_simulated.is_(True)).values(is_online=False))
        db.commit()

    online = client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7815, "lng": 90.4140})
    assert online.status_code == 200 and online.json()["is_online"]

    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    offer = client.get("/api/rider/offer", headers=rider_h).json()
    assert offer["trip"]["id"] == trip["id"]

    assert client.post(f"/api/rider/offers/{trip['id']}/accept", headers=rider_h).json()["status"] == "accepted"
    assert client.post("/api/rider/online", headers=rider_h, json={"is_online": False}).status_code == 409
    assert client.post(f"/api/rider/trips/{trip['id']}/start", headers=rider_h).json()["status"] == "ongoing"

    # 3 km off the straight Gulshan -> Dhanmondi route.
    client.post("/api/rider/location", headers=rider_h, json={"lat": 23.80, "lng": 90.36, "speed_kmh": 20})
    alerts = client.get("/api/admin/alerts", headers=admin_h).json()
    alert = next(a for a in alerts if a["trip_id"] == trip["id"])
    assert alert["alert_type"] == "route_deviation" and alert["anomaly_score"] >= 1

    summary = client.post(f"/api/admin/alerts/{alert['id']}/summarize", headers=admin_h).json()["summary"]
    assert "route" in summary.lower()
    assert client.post(f"/api/admin/alerts/{alert['id']}/status", headers=admin_h, json={"status": "reviewed"}).json()["status"] == "reviewed"

    done = client.post(f"/api/rider/trips/{trip['id']}/complete", headers=rider_h).json()
    assert done["status"] == "completed"
    payment = done["payment"]
    assert payment["status"] == "pending" and payment["amount"] == done["fare_final"]
    assert payment["rider_earning"] + payment["commission"] == payment["amount"]

    collected = client.post(f"/api/rider/trips/{trip['id']}/collect", headers=rider_h).json()
    assert collected["payment"]["status"] == "collected"
    me = client.get("/api/rider/me", headers=rider_h).json()
    assert me["earnings_today"] >= payment["rider_earning"]
    assert me["commission_due"] >= payment["commission"]
    # The passenger sees the amount and status, but not the rider's commission split.
    passenger_view = client.get(f"/api/trips/{trip['id']}", headers=user_h).json()["payment"]
    assert passenger_view["status"] == "collected" and passenger_view["commission"] is None


def test_declined_offer_with_no_other_riders_cancels(client, user_h, rider_h):
    client.post("/api/rider/online", headers=rider_h, json={"is_online": True})
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    assert client.post(f"/api/rider/offers/{trip['id']}/decline", headers=rider_h).status_code == 200
    after = client.get(f"/api/trips/{trip['id']}", headers=user_h).json()
    assert after["status"] == "cancelled" and after["cancelled_by"] == "system"


def test_offer_expires(client, user_h, rider_h, monkeypatch):
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    with SessionLocal() as db:
        t = db.get(Trip, trip["id"])
        t.offered_at = t.offered_at - timedelta(seconds=settings.offer_timeout_seconds + 1)
        db.commit()
    assert client.get("/api/rider/offer", headers=rider_h).json() is None
    assert client.get(f"/api/trips/{trip['id']}", headers=user_h).json()["status"] == "cancelled"


def test_no_riders_returns_409(client, user_h):
    resp = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "car"})
    assert resp.status_code == 409
    assert "car" in resp.json()["detail"]


def test_long_stop_alert(client, user_h, rider_h):
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    client.post(f"/api/rider/offers/{trip['id']}/accept", headers=rider_h)
    client.post(f"/api/rider/trips/{trip['id']}/start", headers=rider_h)
    with SessionLocal() as db:
        t = db.get(Trip, trip["id"])
        t.started_at = t.started_at - timedelta(minutes=5)
        db.commit()
    client.post("/api/rider/location", headers=rider_h, json={**GULSHAN, "speed_kmh": 0})
    with SessionLocal() as db:
        types = set(db.scalars(select(SafetyAlert.alert_type).where(SafetyAlert.trip_id == trip["id"])))
    assert types == {"long_stop"}
    client.post(f"/api/rider/trips/{trip['id']}/complete", headers=rider_h)


def test_admin_dashboard_endpoints(client, admin_h):
    stats = client.get("/api/admin/stats", headers=admin_h).json()
    assert stats["pending_riders"] == 1
    assert stats["eta_mae_min_7d"] is not None

    forecasts = client.get("/api/admin/forecasts", headers=admin_h).json()
    assert len(forecasts["zones"]) == 12 and len(forecasts["hourly"]) == 24
    assert sum(z["total"] for z in forecasts["zones"]) > 0

    riders = client.get("/api/admin/riders", headers=admin_h, params={"status_filter": "pending"}).json()
    assert len(riders) == 1
    rider_id = riders[0]["id"]
    # Verification is blocked until every required document is approved.
    blocked = client.post(f"/api/admin/riders/{rider_id}/verify", headers=admin_h)
    assert blocked.status_code == 409 and "Driving licence" in blocked.json()["detail"]
    docs = client.get(f"/api/admin/riders/{rider_id}/documents", headers=admin_h).json()["required"]
    for d in docs:
        assert client.post(f"/api/admin/documents/{d['document']['id']}/review", headers=admin_h, json={"status": "approved"}).status_code == 200
    assert client.post(f"/api/admin/riders/{rider_id}/verify", headers=admin_h).json()["status"] == "verified"

    rules = client.get("/api/admin/pricing", headers=admin_h).json()
    bike = next(r for r in rules if r["vehicle_type"] == "bike")
    updated = client.put("/api/admin/pricing/bike", headers=admin_h, json={**{k: bike[k] for k in ("base_fare", "per_km", "per_min", "min_fare", "max_multiplier")}, "base_fare": 25})
    assert updated.json()["base_fare"] == 25

    live = client.get("/api/admin/trips/live", headers=admin_h).json()
    assert "trips" in live and "riders" in live


def test_register_rider_needs_verification(client):
    body = {
        "full_name": "New Rider", "email": "new.rider@example.com", "phone": "+8801700000000", "password": "secret1",
        "role": "rider", "license_no": "DK-1", "vehicle_type": "cng", "plate_no": "dhaka metro-tha 11-1111", "vehicle_model": "Bajaj RE",
    }
    resp = client.post("/api/auth/register", json=body)
    assert resp.status_code == 201, resp.text
    h = {"Authorization": f"Bearer {resp.json()['token']}"}
    assert client.post("/api/rider/online", headers=h, json={"is_online": True, "lat": 23.78, "lng": 90.41}).status_code == 403
    assert client.post("/api/auth/register", json=body).status_code == 409
    incomplete = {**body, "email": "x@example.com", "license_no": None}
    assert client.post("/api/auth/register", json=incomplete).status_code == 422


def test_assistant_fallback_suggests_booking(client, user_h):
    resp = client.post("/api/assistant/chat", headers=user_h, json={"messages": [{"role": "user", "content": "I need a car from Banani to Motijheel"}]})
    body = resp.json()
    assert body["source"] == "fallback"
    assert body["booking"]["pickup_zone"] == "Banani"
    assert body["booking"]["drop_zone"] == "Motijheel"
    assert body["booking"]["vehicle_type"] == "car"
