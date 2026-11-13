"""Favourite and blocked riders (#47)."""

from sqlalchemy import select, update

from app.db import SessionLocal, utcnow
from app.models import Rider, Trip, Vehicle

from .test_passenger_features import DHANMONDI, GULSHAN, RIDER_START, _book, _finish, _free_the_demo_rider, _passenger


def _demo_rider_id(client, rider_h) -> str:
    return client.get("/api/rider/me", headers=rider_h).json()["id"]


def _ride_once(client, p, rider_h) -> None:
    trip = _book(client, p, rider_h)
    _finish(client, trip["id"], rider_h)


def _closer_simulated_bike() -> str:
    """Put one simulated bike right at the pickup, so it beats the demo rider on score."""
    with SessionLocal() as db:
        rider = db.scalars(
            select(Rider).join(Vehicle, Vehicle.rider_id == Rider.id).where(Rider.is_simulated.is_(True), Vehicle.vehicle_type == "bike")
        ).first()
        rider.is_online, rider.current_lat, rider.current_lng, rider.last_seen = True, GULSHAN["lat"], GULSHAN["lng"], utcnow()
        db.commit()
        return rider.id


def _offered_to(trip_id: str) -> str | None:
    with SessionLocal() as db:
        return db.get(Trip, trip_id).offered_rider_id


def _book_raw(client, p):
    return client.post("/api/trips", headers=p, json={"pickup": GULSHAN, "drop": DHANMONDI, "vehicle_type": "bike"})


def _demo_rider_further_away(client, rider_h) -> None:
    _free_the_demo_rider(client, rider_h)
    far = {"lat": RIDER_START["lat"] + 0.02, "lng": RIDER_START["lng"]}  # about 2 km north, still in range
    client.post("/api/rider/location", headers=rider_h, json=far)


def test_only_riders_you_rode_with_can_be_favourited_or_blocked(client, rider_h):
    p = _passenger(client, "prefs.stranger@example.com")
    rid = _demo_rider_id(client, rider_h)
    assert client.put(f"/api/passenger/riders/{rid}", headers=p, json={"kind": "favourite"}).status_code == 403
    assert client.put(f"/api/passenger/riders/{rid}", headers=p, json={"kind": "blocked"}).status_code == 403
    assert client.put("/api/passenger/riders/nope", headers=p, json={"kind": "blocked"}).status_code == 404


def test_favourite_rider_is_offered_first(client, rider_h):
    p = _passenger(client, "prefs.fav@example.com")
    rid = _demo_rider_id(client, rider_h)
    _ride_once(client, p, rider_h)

    # Without a favourite, the closer simulated bike gets the offer.
    _demo_rider_further_away(client, rider_h)
    sim = _closer_simulated_bike()
    first = _book_raw(client, p).json()
    assert _offered_to(first["id"]) == sim
    client.post(f"/api/trips/{first['id']}/cancel", headers=p)

    fav = client.put(f"/api/passenger/riders/{rid}", headers=p, json={"kind": "favourite"})
    assert fav.status_code == 200 and fav.json()["trips_together"] == 1
    assert fav.json()["name"] == "Demo"  # first name only, no phone
    assert "phone" not in fav.json()

    _demo_rider_further_away(client, rider_h)
    _closer_simulated_bike()
    second = _book_raw(client, p).json()
    assert _offered_to(second["id"]) == rid
    client.post(f"/api/trips/{second['id']}/cancel", headers=p)

    listed = client.get("/api/passenger/riders", headers=p).json()
    assert [r["rider_id"] for r in listed["favourites"]] == [rid] and listed["blocked"] == []
    assert client.delete(f"/api/passenger/riders/{rid}", headers=p).status_code == 204
    assert client.get("/api/passenger/riders", headers=p).json()["favourites"] == []

    with SessionLocal() as db:
        db.execute(update(Rider).where(Rider.is_simulated.is_(True)).values(is_online=False))
        db.commit()


def test_blocked_rider_is_never_offered_your_trips(client, rider_h, admin_h):
    p = _passenger(client, "prefs.block@example.com")
    rid = _demo_rider_id(client, rider_h)
    _ride_once(client, p, rider_h)
    client.put(f"/api/passenger/riders/{rid}", headers=p, json={"kind": "favourite"})

    blocked = client.put(f"/api/passenger/riders/{rid}", headers=p, json={"kind": "blocked", "reason": "Rude"})
    assert blocked.json()["kind"] == "blocked" and blocked.json()["reason"] == "Rude"
    listed = client.get("/api/passenger/riders", headers=p).json()
    assert listed["favourites"] == [] and len(listed["blocked"]) == 1  # blocking replaces the favourite

    # The demo rider is the only bike online, so with them blocked there is nobody to offer the trip to.
    _free_the_demo_rider(client, rider_h)
    refused = _book_raw(client, p)
    assert refused.status_code == 409
    assert client.get("/api/rider/offer", headers=rider_h).json() is None

    # Other passengers are not affected, and the rider is not told.
    other = _passenger(client, "prefs.other@example.com")
    trip = _book(client, other, rider_h)
    assert trip["status"] == "accepted"
    client.post(f"/api/trips/{trip['id']}/cancel", headers=other)
    assert "blocked" not in str(client.get("/api/rider/me", headers=rider_h).json()).lower()

    admin_row = next(r for r in client.get("/api/admin/riders", headers=admin_h).json() if r["id"] == rid)
    assert admin_row["blocked_by"] >= 1

    assert client.delete(f"/api/passenger/riders/{rid}", headers=p).status_code == 204
    assert _book(client, p, rider_h)["status"] == "accepted"  # unblocked: matched again
