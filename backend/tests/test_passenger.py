from sqlalchemy import Column, MetaData, String, Table, create_engine, inspect, update

from app.db import SessionLocal
from app.models import Rider

from .conftest import login

GULSHAN = {"lat": 23.7810, "lng": 90.4150}
DHANMONDI = {"lat": 23.7465, "lng": 90.3745}


def _all_sim_riders_online():
    with SessionLocal() as db:
        db.execute(update(Rider).where(Rider.is_simulated.is_(True)).values(is_online=True))
        db.commit()


def test_summary_reflects_seeded_history(client, user_h):
    s = client.get("/api/passenger/summary", headers=user_h).json()
    assert s["trips_completed"] > 0 and s["spent_total"] > 0
    assert len(s["weekly"]) == 12
    assert sum(s["by_vehicle"].values()) == s["trips_completed"]
    assert s["favorite_vehicle"] in ("bike", "cng", "car")
    assert s["top_destinations"] and {"address", "trips", "lat", "lng"} <= s["top_destinations"][0].keys()


def test_fare_breakdown_adds_up(client, user_h):
    est = client.post("/api/trips/estimate", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI}).json()
    for q in est["quotes"]:
        b = q["breakdown"]
        assert b["total"] == q["fare"]
        assert b["subtotal"] == max(b["min_fare"], round(b["base"] + b["distance"] + b["time"]))
        assert b["total"] == b["subtotal"] + b["demand_surcharge"]

    history = client.get("/api/trips", headers=user_h, params={"status_filter": "completed", "limit": 5}).json()
    assert history and all(t["status"] == "completed" and t["fare_breakdown"] for t in history)
    page2 = client.get("/api/trips", headers=user_h, params={"status_filter": "completed", "limit": 5, "offset": 5}).json()
    assert {t["id"] for t in history}.isdisjoint(t["id"] for t in page2)


def test_saved_places_crud(client, user_h):
    created = client.post("/api/passenger/places", headers=user_h, json={"label": "Home", **GULSHAN})
    assert created.status_code == 201
    place = created.json()
    assert place["address"] == "Near Gulshan"
    assert client.post("/api/passenger/places", headers=user_h, json={"label": "home", **DHANMONDI}).status_code == 409
    assert [p["label"] for p in client.get("/api/passenger/places", headers=user_h).json()] == ["Home"]
    assert client.delete(f"/api/passenger/places/{place['id']}", headers=user_h).status_code == 204
    assert client.get("/api/passenger/places", headers=user_h).json() == []


def test_sos_is_visible_to_admin_but_not_rider(client, user_h, rider_h, admin_h):
    _all_sim_riders_online()
    trip = client.post("/api/trips", headers=user_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"}).json()
    # Not accepted yet: SOS is only for trips in progress.
    assert client.post(f"/api/trips/{trip['id']}/sos", headers=user_h, json={}).status_code == 409

    with SessionLocal() as db:
        from app.models import Trip
        from app.services import trips as trip_service

        t = db.get(Trip, trip["id"])
        trip_service.accept(db, t, db.get(Rider, t.offered_rider_id))
        db.commit()

    after = client.post(f"/api/trips/{trip['id']}/sos", headers=user_h, json={"note": "Driver is scaring me"}).json()
    assert after["sos_active"] is True
    again = client.post(f"/api/trips/{trip['id']}/sos", headers=user_h, json={}).json()
    assert again["sos_active"] is True

    sos_alerts = [a for a in client.get("/api/admin/alerts", headers=admin_h).json() if a["trip_id"] == trip["id"]]
    assert len(sos_alerts) == 1 and sos_alerts[0]["alert_type"] == "sos"
    assert sos_alerts[0]["details"]["note"] == "Driver is scaring me"
    summary = client.post(f"/api/admin/alerts/{sos_alerts[0]['id']}/summarize", headers=admin_h).json()["summary"]
    assert "emergency" in summary.lower()

    client.post(f"/api/trips/{trip['id']}/cancel", headers=user_h)


def test_report_after_trip(client, user_h, admin_h):
    done = client.get("/api/trips", headers=user_h, params={"status_filter": "completed", "limit": 1}).json()[0]
    resp = client.post(f"/api/trips/{done['id']}/report", headers=user_h, json={"category": "lost_item", "note": "Left my umbrella"})
    assert resp.status_code == 201
    assert client.post(f"/api/trips/{done['id']}/report", headers=user_h, json={"category": "nope", "note": "x"}).status_code == 422
    reports = [a for a in client.get("/api/admin/alerts", headers=admin_h).json() if a["alert_type"] == "report"]
    assert reports[0]["details"]["category"] == "lost_item"


def test_profile_and_password(client):
    reg = client.post(
        "/api/auth/register",
        json={"full_name": "Acct Test", "email": "acct@example.com", "phone": "+8801711111111", "password": "first-pass"},
    ).json()
    h = {"Authorization": f"Bearer {reg['token']}"}
    updated = client.patch("/api/auth/me", headers=h, json={"full_name": "Account Tester", "phone": "+8801722222222"}).json()
    assert updated["full_name"] == "Account Tester"
    assert client.post("/api/auth/password", headers=h, json={"current_password": "wrong", "new_password": "second-pass"}).status_code == 400
    assert client.post("/api/auth/password", headers=h, json={"current_password": "first-pass", "new_password": "second-pass"}).status_code == 204
    login(client, "acct@example.com", "second-pass")


def test_create_schema_adds_new_nullable_columns(tmp_path, monkeypatch):
    from app import db as dbmod

    engine = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    old = MetaData()
    Table("trips", old, Column("id", String, primary_key=True))  # a pre-existing table from an older schema
    old.create_all(engine)
    monkeypatch.setattr(dbmod, "engine", engine)
    dbmod.create_schema()
    cols = {c["name"] for c in inspect(engine).get_columns("trips")}
    assert "fare_breakdown_json" in cols  # nullable column added in place
    assert "status" not in cols  # NOT NULL columns are never added to existing tables
    assert inspect(engine).has_table("saved_places")  # missing tables are created
