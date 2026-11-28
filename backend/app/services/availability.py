"""Which riders are online, verified, free and close enough to take a trip."""

from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.db import utcnow
from app.geo import Point, haversine_km
from app.models import Profile, Rider, Trip, Vehicle
from app.security import account_is_suspended


def online_rider_clauses(now: datetime | None = None):
    """SQLAlchemy WHERE clauses for verified, active riders with a fresh heartbeat."""
    cutoff = (now or utcnow()) - timedelta(seconds=settings.rider_stale_seconds)
    return (
        Rider.is_online.is_(True),
        Rider.status == "verified",
        or_(Profile.account_status.is_(None), Profile.account_status == "active"),
        # A rider whose app stopped reporting (closed tab, lost signal) is not counted as online.
        or_(Rider.is_simulated.is_(True), Rider.last_seen >= cutoff),
    )


def online_riders(db: Session, require_location: bool = False) -> list[Rider]:
    """All verified, active riders currently online with a fresh heartbeat."""
    stmt = (
        select(Rider)
        .join(Profile, Profile.id == Rider.profile_id)
        .where(*online_rider_clauses())
        .options(selectinload(Rider.vehicles), selectinload(Rider.profile))
    )
    if require_location:
        stmt = stmt.where(Rider.current_lat.is_not(None), Rider.current_lng.is_not(None))
    return list(db.scalars(stmt).all())


def is_rider_truly_online(rider: Rider, now: datetime | None = None) -> bool:
    """Whether a rider is verified, active, online, and has a fresh heartbeat."""
    if not rider.is_online or rider.status != "verified":
        return False
    if rider.profile is not None and account_is_suspended(rider.profile):
        return False
    if rider.is_simulated:
        return True
    if rider.last_seen is None:
        return False
    cutoff = (now or utcnow()) - timedelta(seconds=settings.rider_stale_seconds)
    return rider.last_seen >= cutoff


def busy_rider_ids(db: Session) -> set[str]:
    on_trip = db.scalars(select(Trip.rider_id).where(Trip.status.in_(("accepted", "ongoing")), Trip.rider_id.is_not(None)))
    offered = db.scalars(select(Trip.offered_rider_id).where(Trip.status == "requested", Trip.offered_rider_id.is_not(None)))
    return set(on_trip) | set(offered)


def distance_to(rider: Rider, p: Point) -> float:
    return haversine_km((rider.current_lat, rider.current_lng), p)


def free_riders_near(db: Session, p: Point, vehicle_type: str, radius_km: float, exclude: set[str] | None = None) -> list[Rider]:
    riders = db.scalars(
        select(Rider)
        .join(Profile, Profile.id == Rider.profile_id)
        .join(Vehicle, Vehicle.rider_id == Rider.id)
        .where(
            *online_rider_clauses(),
            Rider.current_lat.is_not(None),
            Rider.current_lng.is_not(None),
            Vehicle.vehicle_type == vehicle_type,
            Vehicle.verified.is_(True),
            Vehicle.retired_at.is_(None),
        )
        .options(selectinload(Rider.vehicles), selectinload(Rider.profile))
    ).unique()
    blocked = busy_rider_ids(db) | (exclude or set())
    return [
        r
        for r in riders
        if r.id not in blocked
        and r.profile is not None
        and r.profile.account_status in (None, "active")
        and distance_to(r, p) <= radius_km
    ]


def is_rider_eligible(
    rider: Rider | None,
    pickup: Point,
    vehicle_type: str,
    radius_km: float,
    now: datetime | None = None,
) -> bool:
    """Return True if *rider* currently meets all requirements to receive an offer."""
    if rider is None or rider.profile is None:
        return False
    if rider.status != "verified" or rider.profile.account_status not in (None, "active"):
        return False
    if not rider.is_online:
        return False
    if rider.current_lat is None or rider.current_lng is None:
        return False
    now = now or utcnow()
    if not rider.is_simulated and (
        rider.last_seen is None or rider.last_seen < now - timedelta(seconds=settings.rider_stale_seconds)
    ):
        return False
    if not any(v.retired_at is None and v.verified and v.vehicle_type == vehicle_type for v in rider.vehicles):
        return False
    return distance_to(rider, pickup) <= radius_km
