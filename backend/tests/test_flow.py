from datetime import timedelta

from sqlalchemy import select, update

from app.config import settings
from app.db import SessionLocal
from app.models import Rider, SafetyAlert, Trip
from app.services import simulator
from app.services import predictors

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
    assert alert["severity"] == "high"

    summary = client.post(f"/api/admin/alerts/{alert['id']}/summarize", headers=admin_h).json()["summary"]
    assert "route" in summary.lower() and "high" in summary.lower()
    assert client.post(f"/api/admin/alerts/{alert['id']}/status", headers=admin_h, json={"status": "reviewed"}).json()["status"] == "reviewed"
    unresolved = client.post(f"/api/admin/alerts/{alert['id']}/status", headers=admin_h, json={"status": "closed"})
    assert unresolved.status_code == 422
    resolved = client.post(
        f"/api/admin/alerts/{alert['id']}/status",
        headers=admin_h,
        json={"status": "closed", "resolution_note": "Confirmed safe route and contacted rider."},
    ).json()
    assert resolved["status"] == "closed"
    assert resolved["resolution_note"] == "Confirmed safe route and contacted rider."
    assert client.get("/api/admin/alerts", headers=admin_h, params={"status_filter": "resolved"}).json()[0]["id"] == alert["id"]

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


def test_long_stop_alert(client, user_h, rider_h, admin_h):
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
    alert = next(a for a in client.get("/api/admin/alerts", headers=admin_h).json() if a["trip_id"] == trip["id"])
    assert alert["severity"] == "moderate"
    client.post(f"/api/rider/trips/{trip['id']}/complete", headers=rider_h)


def test_admin_dashboard_endpoints(client, admin_h, user_h):
    stats = client.get("/api/admin/stats", headers=admin_h).json()
    assert stats["pending_riders"] == 1
    assert stats["eta_mae_min_7d"] is not None

    forecasts = client.get("/api/admin/forecasts", headers=admin_h).json()
    assert len(forecasts["zones"]) == 12 and len(forecasts["hourly"]) == 24
    assert sum(z["total"] for z in forecasts["zones"]) > 0
    assert forecasts["horizon_minutes"] == 60
    assert forecasts["model_comparison"]["baseline"]["status"] == "active"
    assert forecasts["model_comparison"]["deep_learning"]["status"] == "pending"

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
    pricing_body = {k: bike[k] for k in ("base_fare", "per_km", "per_min", "min_fare", "max_multiplier", "commission_pct")}
    pricing_body.update(base_fare=25, max_multiplier=1.6)
    updated = client.put("/api/admin/pricing/bike", headers=admin_h, json=pricing_body)
    assert updated.json()["base_fare"] == 25
    rule_history = client.get("/api/admin/pricing/rule-history", headers=admin_h).json()
    assert rule_history["items"][0]["vehicle_type"] == "bike"
    assert rule_history["items"][0]["previous_values"]["base_fare"] == bike["base_fare"]
    assert rule_history["items"][0]["current_values"]["max_multiplier"] == 1.6
    assert rule_history["items"][0]["changed_by_email"] == "admin@ride.local"

    unchanged = client.put("/api/admin/pricing/bike", headers=admin_h, json=pricing_body)
    assert unchanged.status_code == 200
    assert len(client.get("/api/admin/pricing/rule-history", headers=admin_h).json()["items"]) == len(rule_history["items"])

    multiplier_history = client.get("/api/admin/pricing/multiplier-history", headers=admin_h).json()
    assert multiplier_history["items"]
    assert {"trip_id", "vehicle_type", "multiplier", "requested_at"} <= multiplier_history["items"][0].keys()
    assert client.get("/api/admin/pricing/multiplier-history?vehicle_type=unknown", headers=admin_h).status_code == 422
    assert client.get("/api/admin/pricing/rule-history", headers=user_h).status_code == 403

    live = client.get("/api/admin/trips/live", headers=admin_h).json()
    assert "trips" in live and "riders" in live


def test_demand_forecast_horizons_and_vehicle_breakdowns(client, admin_h):
    results = {
        minutes: client.get(
            "/api/admin/forecasts", headers=admin_h, params={"horizon_minutes": minutes}
        ).json()
        for minutes in (15, 30, 60)
    }

    for minutes, result in results.items():
        assert result["horizon_minutes"] == minutes
        assert len(result["zones"]) == 12
        for zone in result["zones"]:
            assert set(zone["free_riders_by_type"]) == {"bike", "cng", "car"}
            assert abs(zone["total"] - sum(zone[vehicle] for vehicle in ("bike", "cng", "car"))) < 0.02
        assert set(result["hourly"][0]["forecast_by_vehicle"]) == {"bike", "cng", "car"}
        assert result["hourly"][0]["actual_by_vehicle"] is not None
        metrics = result["model_comparison"]["baseline"]["metrics"]
        assert set(metrics["by_vehicle"]) == {"bike", "cng", "car"}

    for short, medium, long in zip(results[15]["zones"], results[30]["zones"], results[60]["zones"]):
        assert short["total"] <= medium["total"] <= long["total"]
    assert client.get("/api/admin/forecasts?horizon_minutes=45", headers=admin_h).status_code == 422


def test_registered_deep_learning_demand_model_is_used(client, admin_h, monkeypatch):
    class ConstantDemandModel:
        name = "test-demand-dl"
        kind = "deep-learning"
        description = "Test model"

        def predict(self, features):
            return 1.0

    monkeypatch.setitem(predictors.registry, "demand", ConstantDemandModel())
    response = client.get("/api/admin/forecasts?horizon_minutes=30", headers=admin_h)
    assert response.status_code == 200, response.text
    forecasts = response.json()

    assert forecasts["model"] == "test-demand-dl"
    assert forecasts["zones"][0]["bike"] == 2.0
    comparison = forecasts["model_comparison"]
    assert comparison["baseline"]["status"] == "comparison"
    assert comparison["deep_learning"]["status"] == "active"
    assert comparison["deep_learning"]["predictions_by_vehicle"]["bike"] == 24.0


def test_register_rider_needs_verification(client):
    body = {
        "full_name": "New Rider", "email": "new.rider@example.com", "phone": "+8801700000000", "password": "secret123",
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


def test_offer_details_decline_feeds_cancel_rate_and_vehicle_guard(client, user_h, rider_h):
    client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7810, "lng": 90.4150})
    before_rate = client.get("/api/rider/me", headers=rider_h).json()["cancel_rate"]

    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    offer = client.get("/api/rider/offer", headers=rider_h).json()
    assert offer is not None
    assert offer["trip"]["id"] == trip["id"]
    assert offer["trip"]["passenger_name"]
    assert offer["trip"]["pickup_eta_min"] is not None
    assert offer["pickup_distance_km"] >= 0

    assert client.post(f"/api/rider/offers/{trip['id']}/decline", headers=rider_h).status_code == 200
    after_rate = client.get("/api/rider/me", headers=rider_h).json()["cancel_rate"]
    assert after_rate > before_rate

    mismatched = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    with SessionLocal() as db:
        db.execute(update(Trip).where(Trip.id == mismatched["id"]).values(vehicle_type_requested="car"))
        db.commit()

    bad_accept = client.post(f"/api/rider/offers/{mismatched['id']}/accept", headers=rider_h)
    assert bad_accept.status_code == 409 and "vehicle type" in bad_accept.json()["detail"].lower()
    assert client.get("/api/rider/offer", headers=rider_h).json() is None


def test_rider_otp_signup_and_onboarding_vehicle(client):
    req = client.post("/api/auth/otp/request", json={"email": "otp.rider@example.com", "phone": "+8801799999999"})
    assert req.status_code == 200
    assert client.post("/api/auth/otp/verify", json={"phone": "+8801799999999", "otp": "123456"}).status_code == 400
    assert client.post("/api/auth/otp/verify", json={"phone": "+8801799999999", "otp": "000000"}).status_code == 200

    reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "OTP Rider",
            "email": "otp.rider@example.com",
            "phone": "+8801799999999",
            "password": "secret123",
            "role": "rider",
            "otp": "000000",
        },
    )
    assert reg.status_code == 201, reg.text
    data = reg.json()
    assert data["profile"]["phone_verified"] is True
    h = {"Authorization": f"Bearer {data['token']}"}

    me_before = client.get("/api/rider/me", headers=h).json()
    assert me_before["status"] == "pending" and me_before["vehicle"] is None

    saved = client.post(
        "/api/rider/onboarding/vehicle",
        headers=h,
        json={
            "vehicle_type": "car",
            "model": "Toyota Axio",
            "plate_no": "dhaka metro-ga 22-3344",
            "color": "Pearl White",
            "registration_no": "reg-998877",
            "license_no": "DK-9988",
        },
    )
    assert saved.status_code == 200, saved.text
    v = saved.json()["vehicle"]
    assert v["vehicle_type"] == "car"
    assert v["plate_no"] == "DHAKA METRO GA-22-3344"
    assert v["color"] == "Pearl White"
    assert v["registration_no"] == "REG-998877"
    assert v["verified"] is False
    assert saved.json()["license_no"] == "DK-9988"
    assert saved.json()["earnings_today"] == 0 and saved.json()["trips_completed"] == 0

    from app.services.documents import placeholder_png

    selfie = client.post(
        "/api/rider/documents",
        headers=h,
        data={"doc_type": "photo", "use_as_profile_photo": "true"},
        files={"file": ("selfie.png", placeholder_png("selfie"), "image/png")},
    )
    assert selfie.status_code == 201, selfie.text
    assert client.get("/api/rider/me", headers=h).json()["avatar_url"] == f"/api/documents/{selfie.json()['id']}/file"


def test_brta_dataset_and_plate_format(client):
    res = client.get("/api/brta")
    assert res.status_code == 200
    data = res.json()
    assert len(data["regions"]) == 69
    assert any(r["code"] == "DHAKA METRO" and r["bengali"] == "ঢাকা মেট্রো" for r in data["regions"])
    assert any(r["code"] == "SHERPUR" and r["bengali"] == "শেরপুর" for r in data["regions"])
    assert any(c["code"] == "HA" and c["bengali"] == "হ" and c["vehicle_type"] == "bike" for c in data["class_codes"])
    assert any(c["code"] == "KA" and c["bengali"] == "ক" and c["vehicle_type"] == "car" for c in data["class_codes"])
    assert any(c["code"] == "THA" and c["bengali"] == "থ" and c["vehicle_type"] == "cng" for c in data["class_codes"])


def test_trip_navigation_status_steps_and_tracking(client, user_h, rider_h):
    with SessionLocal() as db:
        db.execute(update(Rider).where(Rider.is_simulated.is_(True)).values(is_online=False))
        db.commit()

    online = client.post("/api/rider/online", headers=rider_h, json={"is_online": True, "lat": 23.7815, "lng": 90.4140})
    assert online.status_code == 200

    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    trip_id = trip["id"]

    # 1. Accept trip: approach route is generated
    accepted = client.post(f"/api/rider/offers/{trip_id}/accept", headers=rider_h).json()
    assert accepted["status"] == "accepted"
    assert accepted["arrived_at"] is None
    assert len(accepted["approach"]) >= 2
    assert len(accepted["route"]) >= 2

    # 2. Live tracking while heading to pickup: GPS ping updates rider location and tracks
    ping = client.post("/api/rider/location", headers=rider_h, json={"lat": 23.7850, "lng": 90.4150, "speed_kmh": 25.0, "accuracy_m": 5})
    assert ping.status_code == 200

    # 3. Arrived step: Rider explicitly marks arrived
    arrived = client.post(f"/api/rider/trips/{trip_id}/arrived", headers=rider_h).json()
    assert arrived["status"] == "accepted"
    assert arrived["arrived_at"] is not None

    # Idempotent arrival
    arrived_again = client.post(f"/api/rider/trips/{trip_id}/arrived", headers=rider_h).json()
    assert arrived_again["arrived_at"] == arrived["arrived_at"]

    # 4. Start trip: status becomes ongoing
    started = client.post(f"/api/rider/trips/{trip_id}/start", headers=rider_h).json()
    assert started["status"] == "ongoing"
    assert started["started_at"] is not None

    # Calling arrived on ongoing trip returns 409
    assert client.post(f"/api/rider/trips/{trip_id}/arrived", headers=rider_h).status_code == 409

    # 5. Live tracking during trip
    ping2 = client.post("/api/rider/location", headers=rider_h, json={"lat": 23.7700, "lng": 90.3900, "speed_kmh": 30.0, "accuracy_m": 8})
    assert ping2.status_code == 200

    # 6. Complete trip
    completed = client.post(f"/api/rider/trips/{trip_id}/complete", headers=rider_h).json()
    assert completed["status"] == "completed"
    assert completed["completed_at"] is not None

