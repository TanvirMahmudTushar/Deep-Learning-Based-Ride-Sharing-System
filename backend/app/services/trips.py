"""Trip lifecycle: requested -> accepted -> ongoing -> completed, or cancelled at any active step.

Used by the passenger and rider routers and by the simulator, so every path applies the same
rules and sends the same real-time events. Functions flush but do not commit; callers own the
transaction (events go out after the commit).
"""

import json
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.geo import Point, haversine_km
from app.models import ACTIVE_TRIP_STATUSES, Profile, Rider, Trip, TripLocation
from app.realtime import ADMINS, emit
from app.services import alerts, matching, payments, pricing
from app.services.predictors import eta_predictor
from app.services.routing import get_route
from app.services.zones import describe_point, nearest_zone


class TripError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def is_simulated(trip: Trip) -> bool:
    return trip.auto_drive or bool(trip.rider and trip.rider.is_simulated)


def time_scale(trip: Trip) -> float:
    return settings.simulator_speedup if is_simulated(trip) else 1.0


def _rider_profile(trip: Trip) -> str | None:
    return trip.rider.profile_id if trip.rider else None


def _trip_event(db: Session, trip: Trip, notify_passenger: tuple[str, str] | None = None, notify_rider: tuple[str, str] | None = None) -> None:
    emit(db, trip.user_id, "trip.updated", notify=notify_passenger, trip_id=trip.id, status=trip.status)
    if trip.rider:
        emit(db, _rider_profile(trip), "trip.updated", notify=notify_rider, trip_id=trip.id, status=trip.status)
    emit(db, ADMINS, "live.changed", coalesce="admin-live")


def active_trip_for_user(db: Session, user_id: str) -> Trip | None:
    return db.scalar(
        select(Trip).where(Trip.user_id == user_id, Trip.status.in_(ACTIVE_TRIP_STATUSES)).order_by(Trip.requested_at.desc())
    )


def active_trip_for_rider(db: Session, rider_id: str) -> Trip | None:
    return db.scalar(
        select(Trip).where(Trip.rider_id == rider_id, Trip.status.in_(("accepted", "ongoing"))).order_by(Trip.requested_at.desc())
    )


def create_trip(
    db: Session,
    user: Profile,
    pickup: Point,
    drop: Point,
    vehicle_type: str,
    pickup_address: str | None = None,
    drop_address: str | None = None,
) -> Trip:
    if active_trip_for_user(db, user.id):
        raise TripError(409, "You already have an active trip")

    route = get_route(pickup, drop)
    q = pricing.quote(db, pickup, route, vehicle_type)
    zone = nearest_zone(db, pickup)
    trip = Trip(
        user_id=user.id,
        pickup_zone_id=zone.id if zone else None,
        vehicle_type_requested=vehicle_type,
        pickup_lat=pickup[0],
        pickup_lng=pickup[1],
        pickup_address=pickup_address or describe_point(db, pickup),
        drop_lat=drop[0],
        drop_lng=drop[1],
        drop_address=drop_address or describe_point(db, drop),
        distance_km=q.distance_km,
        fare_estimate=q.fare,
        price_multiplier=q.multiplier,
        price_reason=q.reason,
        fare_breakdown_json=json.dumps(q.breakdown),
        predicted_eta_min=q.eta_min,
    )
    trip.route = route.points
    db.add(trip)
    db.flush()

    matching.rank_candidates(db, trip)
    if not matching.offer_next(db, trip):
        db.rollback()
        raise TripError(409, f"No {vehicle_type} riders are available nearby right now. Try another vehicle type.")
    emit(db, ADMINS, "live.changed", coalesce="admin-live")
    return trip


def advance_offer(db: Session, trip: Trip) -> None:
    if matching.offer_next(db, trip):
        emit(db, trip.user_id, "trip.updated", trip_id=trip.id, status=trip.status)
    else:
        cancel(db, trip, "system", "No rider accepted the request")


def expire_stale_offers(db: Session) -> int:
    cutoff = utcnow() - timedelta(seconds=settings.offer_timeout_seconds)
    stale = db.scalars(select(Trip).where(Trip.status == "requested", Trip.offered_at < cutoff)).all()
    for trip in stale:
        expired = db.get(Rider, trip.offered_rider_id)
        matching.set_offer_status(db, trip, trip.offered_rider_id, "expired")
        emit(db, expired.profile_id if expired else None, "offer.closed", trip_id=trip.id)
        advance_offer(db, trip)
    return len(stale)


def accept(db: Session, trip: Trip, rider: Rider) -> Trip:
    if trip.status != "requested" or trip.offered_rider_id != rider.id:
        raise TripError(409, "This trip is no longer offered to you")
    now = utcnow()
    trip.status = "accepted"
    trip.rider_id = rider.id
    trip.vehicle_id = rider.vehicle.id if rider.vehicle else None
    trip.accepted_at = now
    trip.offered_rider_id = None
    trip.sim_progress_km = 0.0
    matching.set_offer_status(db, trip, rider.id, "accepted")

    approach = get_route((rider.current_lat, rider.current_lng), (trip.pickup_lat, trip.pickup_lng))
    trip.approach = approach.points
    trip.pickup_eta_min = eta_predictor.predict_eta(approach.distance_km, trip.vehicle_type_requested, now)
    db.flush()
    db.refresh(trip, ["rider"])
    vehicle = f"{rider.vehicle.model} · {rider.vehicle.plate_no}" if rider.vehicle else "your rider"
    _trip_event(db, trip, notify_passenger=("Rider on the way", f"{rider.profile.full_name}, {vehicle}. Pickup in about {round(trip.pickup_eta_min)} min."))
    return trip


def decline(db: Session, trip: Trip, rider: Rider) -> None:
    if trip.status != "requested" or trip.offered_rider_id != rider.id:
        raise TripError(409, "This trip is no longer offered to you")
    matching.set_offer_status(db, trip, rider.id, "declined")
    advance_offer(db, trip)


def start(db: Session, trip: Trip) -> Trip:
    if trip.status != "accepted":
        raise TripError(409, "Only an accepted trip can be started")
    trip.status = "ongoing"
    trip.started_at = utcnow()
    trip.arrived_at = trip.arrived_at or trip.started_at
    trip.sim_progress_km = 0.0
    db.flush()
    _trip_event(db, trip, notify_passenger=("Trip started", f"Heading to {trip.drop_address}."))
    return trip


def complete(db: Session, trip: Trip) -> Trip:
    if trip.status != "ongoing":
        raise TripError(409, "Only an ongoing trip can be completed")
    now = utcnow()
    trip.status = "completed"
    trip.completed_at = now
    trip.fare_final = trip.fare_estimate  # fares are fixed up front
    trip.actual_duration_min = round((now - trip.started_at).total_seconds() / 60 * time_scale(trip), 1)
    if trip.rider and is_simulated(trip):
        trip.rider.current_lat, trip.rider.current_lng = trip.drop_lat, trip.drop_lng
    db.flush()
    payment = payments.create_for_trip(db, trip)
    if trip.rider and trip.rider.is_simulated:
        payments.mark_collected(payment)  # simulated riders "collect" instantly
    _trip_event(db, trip, notify_passenger=("You have arrived", f"Please pay ৳{payment.amount:.0f} in cash to your rider."))
    return trip


def cancel(db: Session, trip: Trip, by: str, reason: str | None = None) -> Trip:
    if trip.status not in ("requested", "accepted"):
        raise TripError(409, "This trip can no longer be cancelled")
    offered = trip.offered_rider_id if trip.status == "requested" else None
    if offered:
        matching.set_offer_status(db, trip, offered, "expired")
    trip.status = "cancelled"
    trip.cancelled_by = by
    trip.cancel_reason = reason
    trip.offered_rider_id = None
    trip.offered_at = None
    trip.completed_at = utcnow()
    db.flush()

    if by == "rider":
        _trip_event(db, trip, notify_passenger=("Rider cancelled", "Sorry about that. Please book again; we'll find another rider."))
    elif by == "system":
        _trip_event(db, trip, notify_passenger=("No rider found", reason or "No rider accepted the request."))
    else:
        _trip_event(db, trip, notify_rider=("Trip cancelled", "The passenger cancelled this trip."))
    if offered:
        rider = db.get(Rider, offered)
        emit(db, rider.profile_id if rider else None, "offer.closed", trip_id=trip.id)
    return trip


def _speed_from_last_fix(rider: Rider, p: Point, now) -> float:
    if rider.current_lat is None or rider.last_seen is None:
        return 0.0
    seconds = (now - rider.last_seen).total_seconds()
    if seconds <= 0 or seconds > 120:
        return 0.0
    return haversine_km((rider.current_lat, rider.current_lng), p) / (seconds / 3600)


def record_location(
    db: Session, trip: Trip | None, rider: Rider, p: Point, speed_kmh: float | None = None, accuracy_m: float | None = None
) -> None:
    """One GPS fix from the rider's device (or the simulator). `trip` is the rider's active trip, if any."""
    now = utcnow()
    if speed_kmh is None:
        speed_kmh = _speed_from_last_fix(rider, p, now)
    rider.current_lat, rider.current_lng = p[0], p[1]
    rider.last_seen = now
    emit(db, ADMINS, "live.changed", coalesce="admin-live")
    if trip is None or trip.status not in ("accepted", "ongoing"):
        return

    db.add(TripLocation(trip_id=trip.id, lat=p[0], lng=p[1], speed_kmh=round(speed_kmh, 1), accuracy_m=accuracy_m, recorded_at=now))
    db.flush()
    emit(db, trip.user_id, "trip.location", trip_id=trip.id, lat=round(p[0], 6), lng=round(p[1], 6))

    if trip.status == "accepted" and trip.arrived_at is None:
        if haversine_km(p, (trip.pickup_lat, trip.pickup_lng)) * 1000 <= settings.arrival_radius_m:
            trip.arrived_at = now
            _trip_event(db, trip, notify_passenger=("Your rider has arrived", f"Look for {trip.vehicle.plate_no if trip.vehicle else 'your rider'} at the pickup point."))

    # Poor GPS fixes (large accuracy radius) would cause false route-deviation alerts.
    if accuracy_m is None or accuracy_m <= settings.gps_max_accuracy_m:
        alerts.check_location(db, trip, p, speed_kmh, time_scale(trip))
