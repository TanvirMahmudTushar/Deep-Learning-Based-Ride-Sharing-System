"""Booking and cancellation rules found in the passenger audit: service area, minimum trip length,
free cancellation when the rider is late, and the per-trip report limit."""

from datetime import timedelta

from app.db import SessionLocal
from app.models import Trip

from .test_passenger_features import DHANMONDI, GULSHAN, _book, _finish, _passenger, no_grace  # noqa: F401

CHITTAGONG = {"lat": 22.3569, "lng": 91.7832}
LONDON = {"lat": 51.5, "lng": -0.12}


def test_pickup_and_drop_must_be_apart_and_inside_the_city(client):
    p = _passenger(client, "rules.area@example.com")
    for pickup, drop, words in (
        (GULSHAN, GULSHAN, "too close"),
        (GULSHAN, CHITTAGONG, "drop-off inside the city"),
        (LONDON, GULSHAN, "pickup inside the city"),
    ):
        estimate = client.post("/api/trips/estimate", headers=p, json={"pickup": pickup, "drop": drop})
        assert estimate.status_code == 422 and words in estimate.json()["detail"]
        booked = client.post("/api/trips", headers=p, json={"pickup": pickup, "drop": drop, "vehicle_type": "car"})
        assert booked.status_code == 422
    assert client.get("/api/trips/active", headers=p).json() is None
    assert client.post("/api/trips/estimate", headers=p, json={"pickup": GULSHAN, "drop": DHANMONDI}).status_code == 200


def _make_rider_late(trip_id: str) -> None:
    with SessionLocal() as db:
        trip = db.get(Trip, trip_id)
        trip.accepted_at -= timedelta(minutes=trip.pickup_eta_min + 6)
        db.commit()


def test_cancelling_is_free_when_the_rider_is_late(client, rider_h, no_grace):  # noqa: F811
    p = _passenger(client, "rules.late@example.com")
    trip = _book(client, p, rider_h)
    assert trip["rider_late"] is False
    _make_rider_late(trip["id"])
    assert client.get(f"/api/trips/{trip['id']}", headers=p).json()["rider_late"] is True
    cancelled = client.post(f"/api/trips/{trip['id']}/cancel", headers=p, json={"reason": "rider_not_moving"}).json()
    assert cancelled["status"] == "cancelled" and cancelled["cancel_fee"] is None


def test_a_rider_who_arrived_is_not_late(client, rider_h, no_grace):  # noqa: F811
    p = _passenger(client, "rules.arrived@example.com")
    trip = _book(client, p, rider_h)
    assert client.post(f"/api/rider/trips/{trip['id']}/arrived", headers=rider_h).status_code == 200
    _make_rider_late(trip["id"])
    assert client.get(f"/api/trips/{trip['id']}", headers=p).json()["rider_late"] is False
    cancelled = client.post(f"/api/trips/{trip['id']}/cancel", headers=p, json={"reason": "changed_plans"}).json()
    assert cancelled["cancel_fee"] == 20.0  # the rider waited at the pickup, so the late fee applies


def test_open_reports_per_trip_are_limited(client, rider_h, admin_h):
    p = _passenger(client, "rules.reports@example.com")
    trip = _book(client, p, rider_h)
    _finish(client, trip["id"], rider_h)
    url = f"/api/trips/{trip['id']}/report"
    for i in range(3):
        assert client.post(url, headers=p, json={"category": "other", "note": f"Report {i}"}).status_code == 201
    refused = client.post(url, headers=p, json={"category": "other", "note": "One more"})
    assert refused.status_code == 409 and "open reports" in refused.json()["detail"]

    # Once support closes one, the passenger can report again.
    alert = next(a for a in client.get("/api/admin/alerts", headers=admin_h).json() if a["trip_id"] == trip["id"])
    assert client.post(f"/api/admin/alerts/{alert['id']}/status", headers=admin_h, json={"status": "closed"}).status_code == 200
    assert client.post(url, headers=p, json={"category": "other", "note": "Something new"}).status_code == 201
