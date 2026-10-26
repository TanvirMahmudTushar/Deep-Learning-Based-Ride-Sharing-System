"""Which riders are online, verified, free and close enough to take a trip."""

from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.db import utcnow
from app.geo import Point, haversine_km
from app.models import Rider, Trip, Vehicle


def busy_rider_ids(db: Session) -> set[str]:
    on_trip = db.scalars(select(Trip.rider_id).where(Trip.status.in_(("accepted", "ongoing")), Trip.rider_id.is_not(None)))
    offered = db.scalars(select(Trip.offered_rider_id).where(Trip.status == "requested", Trip.offered_rider_id.is_not(None)))
    return set(on_trip) | set(offered)


def distance_to(rider: Rider, p: Point) -> float:
    return haversine_km((rider.current_lat, rider.current_lng), p)


def free_riders_near(db: Session, p: Point, vehicle_type: str, radius_km: float, exclude: set[str] | None = None) -> list[Rider]:
    riders = db.scalars(
        select(Rider)
        .join(Vehicle, Vehicle.rider_id == Rider.id)
        .where(
            Rider.is_online.is_(True),
            Rider.status == "verified",
            Rider.current_lat.is_not(None),
            # A rider whose app stopped reporting (closed tab, lost signal) is not offered trips.
            or_(Rider.is_simulated.is_(True), Rider.last_seen >= utcnow() - timedelta(seconds=settings.rider_stale_seconds)),
            Vehicle.vehicle_type == vehicle_type,
            Vehicle.verified.is_(True),
        )
        .options(selectinload(Rider.vehicles), selectinload(Rider.profile))
    ).unique()
    blocked = busy_rider_ids(db) | (exclude or set())
    return [r for r in riders if r.id not in blocked and distance_to(r, p) <= radius_km]
