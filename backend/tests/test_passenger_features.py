"""Passenger features: live ETA and chat (#2), review history (#3), export (#4),
cancellation reasons and late fees (#5) and the assistant's live answers (#6)."""

import csv
import io

import pytest
from sqlalchemy import update

from app.config import settings
from app.db import SessionLocal
from app.models import Rider

from .test_auth import _register

GULSHAN = {"lat": 23.7810, "lng": 90.4150}
DHANMONDI = {"lat": 23.7465, "lng": 90.3745}
RIDER_START = {"lat": 23.7815, "lng": 90.4140}


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _passenger(client, email: str) -> dict:
    return _h(_register(client, email).json()["token"])


def _free_the_demo_rider(client, rider_h) -> None:
    """Finish anything an earlier test left the demo rider doing, and make them the only bike online."""
    active = client.get("/api/rider/active", headers=rider_h).json()
    if active and active["status"] == "accepted":
        client.post(f"/api/rider/trips/{active['id']}/cancel", headers=rider_h)
    elif active and active["status"] == "ongoing":
        client.post(f"/api/rider/trips/{active['id']}/complete", headers=rider_h)
    with SessionLocal() as db:
        db.execute(update(Rider).where(Rider.is_simulated.is_(True)).values(is_online=False))
        db.commit()
    assert client.post("/api/rider/online", headers=rider_h, json={"is_online": True, **RIDER_START}).status_code == 200


def _book(client, passenger_h, rider_h, accept: bool = True) -> dict:
    _free_the_demo_rider(client, rider_h)
    booked = client.post("/api/trips", headers=passenger_h, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"})
    assert booked.status_code == 201, booked.text
    trip = booked.json()
    if accept:
        assert client.post(f"/api/rider/offers/{trip['id']}/accept", headers=rider_h).json()["status"] == "accepted"
    return client.get(f"/api/trips/{trip['id']}", headers=passenger_h).json()


def _finish(client, trip_id: str, rider_h) -> dict:
    assert client.post(f"/api/rider/trips/{trip_id}/start", headers=rider_h).json()["status"] == "ongoing"
    return client.post(f"/api/rider/trips/{trip_id}/complete", headers=rider_h).json()


@pytest.fixture
def no_grace(monkeypatch):
    """Make every cancellation after acceptance a late one."""
    monkeypatch.setattr(settings, "late_cancel_grace_seconds", 0)


# --- #5 cancellation ---------------------------------------------------------------------


def test_cancel_before_acceptance_is_free_and_keeps_the_reason(client, rider_h):
    p = _passenger(client, "cancel.early@example.com")
    trip = _book(client, p, rider_h, accept=False)
    cancelled = client.post(f"/api/trips/{trip['id']}/cancel", headers=p, json={"reason": "found_other_ride", "note": "Got a lift"}).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["cancel_reason"] == "Cancelled by passenger: Found another ride (Got a lift)"
    assert cancelled["cancel_fee"] is None


def test_cancelling_within_the_grace_period_is_free(client, rider_h):
    p = _passenger(client, "cancel.grace@example.com")
    trip = _book(client, p, rider_h)
    assert trip["late_cancel_fee"] == 20.0 and trip["free_cancel_until"] is not None
    cancelled = client.post(f"/api/trips/{trip['id']}/cancel", headers=p, json={"reason": "changed_plans"}).json()
    assert cancelled["cancel_fee"] is None
    # An old client that sends no body still works.
    second = _book(client, p, rider_h, accept=False)
    assert client.post(f"/api/trips/{second['id']}/cancel", headers=p).json()["cancel_reason"] == "Cancelled by passenger: Other reason"


def test_late_fee_is_added_to_the_next_ride_and_kept_by_the_platform(client, rider_h, no_grace):
    p = _passenger(client, "cancel.late@example.com")
    first = _book(client, p, rider_h)
    late = client.post(f"/api/trips/{first['id']}/cancel", headers=p, json={"reason": "wait_too_long"}).json()
    assert late["cancel_fee"] == 20.0 and late["cancel_fee_status"] == "owed"

    estimate = client.post("/api/trips/estimate", headers=p, json={"pickup": GULSHAN, "drop": DHANMONDI}).json()
    assert estimate["outstanding_fee"] == 20.0
    assert client.get("/api/passenger/summary", headers=p).json()["outstanding_fee"] == 20.0

    second = _book(client, p, rider_h)
    assert second["fee_adjustment"] == 20.0
    done = _finish(client, second["id"], rider_h)
    payment = done["payment"]
    assert payment["amount"] == done["fare_final"] + 20
    assert payment["rider_earning"] + payment["commission"] == payment["amount"]

    assert client.get(f"/api/trips/{first['id']}", headers=p).json()["cancel_fee_status"] == "paid"
    assert client.get("/api/passenger/summary", headers=p).json()["outstanding_fee"] == 0


def test_rider_earning_is_not_cut_by_a_carried_fee(client, rider_h, no_grace):
    p = _passenger(client, "cancel.earning@example.com")
    first = _book(client, p, rider_h)
    client.post(f"/api/trips/{first['id']}/cancel", headers=p, json={"reason": "other"})
    second = _book(client, p, rider_h)
    done = _finish(client, second["id"], rider_h)
    rider_view = next(t for t in client.get("/api/rider/trips", headers=rider_h).json() if t["id"] == second["id"])
    fare, paid = done["fare_final"], rider_view["payment"]
    # The rider collects fare + 20 in cash; the 20 is all commission, so their earning is what the fare alone gives.
    assert paid["amount"] == fare + 20
    fare_commission = paid["commission"] - 20
    assert paid["rider_earning"] == fare - fare_commission
    assert rider_view["fee_adjustment"] == 20.0
    assert rider_view["cancel_fee"] is None and rider_view["late_cancel_fee"] is None


def test_fee_waits_for_the_next_ride_if_the_carrying_ride_is_cancelled(client, rider_h, no_grace):
    p = _passenger(client, "cancel.carry@example.com")
    first = _book(client, p, rider_h)
    client.post(f"/api/trips/{first['id']}/cancel", headers=p, json={"reason": "other"})
    carrying = _book(client, p, rider_h, accept=False)
    assert carrying["fee_adjustment"] == 20.0
    client.post(f"/api/trips/{carrying['id']}/cancel", headers=p, json={"reason": "other"})
    assert client.get("/api/passenger/summary", headers=p).json()["outstanding_fee"] == 20.0


def test_admin_can_waive_an_owed_fee_and_refund_a_paid_one_as_credit(client, rider_h, admin_h, no_grace):
    p = _passenger(client, "cancel.waive@example.com")
    first = _book(client, p, rider_h)
    client.post(f"/api/trips/{first['id']}/cancel", headers=p, json={"reason": "other"})
    listed = next(f for f in client.get("/api/admin/cancel-fees", headers=admin_h).json() if f["trip_id"] == first["id"])
    assert listed["status"] == "owed" and listed["fee"] == 20.0
    assert client.post(f"/api/admin/trips/{first['id']}/cancel-fee/waive", headers=admin_h).json()["status"] == "waived"
    assert client.get("/api/passenger/summary", headers=p).json()["outstanding_fee"] == 0
    assert client.post(f"/api/admin/trips/{first['id']}/cancel-fee/waive", headers=admin_h).status_code == 409

    # A fee that was already paid comes back as a credit on the next ride.
    second = _book(client, p, rider_h)
    client.post(f"/api/trips/{second['id']}/cancel", headers=p, json={"reason": "other"})
    third = _book(client, p, rider_h)
    _finish(client, third["id"], rider_h)
    assert client.post(f"/api/admin/trips/{second['id']}/cancel-fee/waive", headers=admin_h).json()["status"] == "credited"
    assert client.get("/api/passenger/summary", headers=p).json()["outstanding_fee"] == -20.0
    fourth = _book(client, p, rider_h)
    assert fourth["fee_adjustment"] == -20.0
    done = _finish(client, fourth["id"], rider_h)
    assert done["payment"]["amount"] == done["fare_final"] - 20


def test_admins_set_the_fee_per_vehicle(client, admin_h):
    bike = next(r for r in client.get("/api/admin/pricing", headers=admin_h).json() if r["vehicle_type"] == "bike")
    assert bike["cancel_fee"] == 20.0
    body = {k: bike[k] for k in ("base_fare", "per_km", "per_min", "min_fare", "max_multiplier", "commission_pct")}
    assert client.put("/api/admin/pricing/bike", headers=admin_h, json={**body, "cancel_fee": 25}).json()["cancel_fee"] == 25
    # Saving the other fields without a fee keeps the fee.
    assert client.put("/api/admin/pricing/bike", headers=admin_h, json=body).json()["cancel_fee"] == 25
    client.put("/api/admin/pricing/bike", headers=admin_h, json={**body, "cancel_fee": 20})


# --- #2 live ETA and chat ----------------------------------------------------------------


def test_live_eta_updates_as_the_rider_moves(client, rider_h):
    p = _passenger(client, "eta@example.com")
    trip = _book(client, p, rider_h)
    client.post("/api/rider/location", headers=rider_h, json={"lat": 23.80, "lng": 90.43, "speed_kmh": 20})
    far = client.get("/api/trips/active", headers=p).json()["live_eta_min"]
    client.post("/api/rider/location", headers=rider_h, json={"lat": 23.785, "lng": 90.418, "speed_kmh": 20})
    near = client.get("/api/trips/active", headers=p).json()["live_eta_min"]
    assert far is not None and near is not None and near < far
    client.post(f"/api/trips/{trip['id']}/cancel", headers=p, json={"reason": "other"})


def test_passenger_and_rider_can_message_during_the_trip(client, rider_h):
    p = _passenger(client, "chat@example.com")
    trip = _book(client, p, rider_h)
    sent = client.post(f"/api/trips/{trip['id']}/messages", headers=p, json={"body": "I'm at the blue gate"})
    assert sent.status_code == 201 and sent.json()["mine"]
    reply = client.post(f"/api/rider/trips/{trip['id']}/messages", headers=rider_h, json={"body": "Two minutes away"})
    assert reply.status_code == 201

    seen_by_passenger = client.get(f"/api/trips/{trip['id']}/messages", headers=p).json()
    assert [(m["body"], m["mine"]) for m in seen_by_passenger] == [("I'm at the blue gate", True), ("Two minutes away", False)]
    seen_by_rider = client.get(f"/api/rider/trips/{trip['id']}/messages", headers=rider_h).json()
    assert [m["mine"] for m in seen_by_rider] == [False, True]

    stranger = _passenger(client, "chat.stranger@example.com")
    assert client.get(f"/api/trips/{trip['id']}/messages", headers=stranger).status_code == 404
    assert client.post(f"/api/trips/{trip['id']}/messages", headers=p, json={"body": "   "}).status_code == 422

    _finish(client, trip["id"], rider_h)
    assert client.post(f"/api/trips/{trip['id']}/messages", headers=p, json={"body": "Thanks!"}).status_code == 409
    assert len(client.get(f"/api/trips/{trip['id']}/messages", headers=p).json()) == 2


# --- #3 reviews, #4 export ---------------------------------------------------------------


def test_review_history_lists_ratings_with_comments(client, rider_h):
    p = _passenger(client, "reviews@example.com")
    trip = _book(client, p, rider_h)
    _finish(client, trip["id"], rider_h)
    client.post(f"/api/trips/{trip['id']}/rate", headers=p, json={"stars": 4, "comment": "Safe and quick"})
    reviews = client.get("/api/passenger/reviews", headers=p).json()
    assert len(reviews) == 1
    assert reviews[0]["stars"] == 4 and reviews[0]["comment"] == "Safe and quick" and reviews[0]["rider_name"]


def test_trips_export_as_csv(client, rider_h, no_grace):
    p = _passenger(client, "export@example.com")
    first = _book(client, p, rider_h)
    client.post(f"/api/trips/{first['id']}/cancel", headers=p, json={"reason": "price_too_high"})
    second = _book(client, p, rider_h)
    _finish(client, second["id"], rider_h)

    resp = client.get("/api/passenger/trips/export", headers=p)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "cholo-trips.csv" in resp.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))
    assert rows[0][0] == "Date" and len(rows) == 3
    completed, cancelled = rows[1], rows[2]
    assert completed[7] == "completed" and completed[6] == "20.0"
    assert cancelled[7] == "cancelled" and "Price too high" in cancelled[10] and cancelled[11].startswith("20")


# --- #6 assistant ------------------------------------------------------------------------


def test_assistant_answers_where_the_rider_is_and_explains_cancelling(client, rider_h):
    p = _passenger(client, "assistant.live@example.com")
    trip = _book(client, p, rider_h)
    client.post("/api/rider/location", headers=rider_h, json={"lat": 23.79, "lng": 90.42, "speed_kmh": 20})
    where = client.post("/api/assistant/chat", headers=p, json={"messages": [{"role": "user", "content": "Where is my rider?"}]}).json()
    assert where["source"] == "fallback" and "km" in where["reply"] and "pickup" in where["reply"]
    policy = client.post("/api/assistant/chat", headers=p, json={"messages": [{"role": "user", "content": "Can I cancel for free?"}]}).json()
    assert "free" in policy["reply"].lower()
    client.post(f"/api/trips/{trip['id']}/cancel", headers=p, json={"reason": "other"})
    none = client.post("/api/assistant/chat", headers=p, json={"messages": [{"role": "user", "content": "how long until pickup"}]}).json()
    assert "don't have a rider" in none["reply"]
