"""Trip simulator.

Plays the part of riders' phones for demos and system-level experiments: simulated riders accept
their offers after a short delay, and any trip with a simulated rider (or with auto-drive turned
on from the rider portal) is driven along its route with GPS pings. Time runs `simulator_speedup`
times faster than real time. A fraction of trips get an injected detour or long stop so the
anomaly detector has something to find.
"""

import asyncio
import logging
import random
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, utcnow
from app.geo import offset_point, point_along
from app.models import Rider, Trip
from app.services import trips as trip_service
from app.services.predictors import EtaPredictor, is_peak

log = logging.getLogger(__name__)


@dataclass
class _Plan:
    anomaly: str | None  # "detour", "stop" or None
    at_fraction: float = field(default_factory=lambda: random.uniform(0.3, 0.6))
    ticks_left: int = 0
    triggered: bool = False


_plans: dict[str, _Plan] = {}


def _speed_kmh(trip: Trip) -> float:
    speed = EtaPredictor.SPEED_KMH[trip.vehicle_type_requested]
    if is_peak(utcnow()):
        speed /= EtaPredictor.PEAK_FACTOR
    return speed * random.uniform(0.85, 1.15)


def _plan_for(trip: Trip) -> _Plan:
    if trip.id not in _plans:
        anomaly = random.choice(["detour", "stop"]) if random.random() < settings.simulator_anomaly_rate else None
        _plans[trip.id] = _Plan(anomaly=anomaly)
    return _plans[trip.id]


def tick(db: Session) -> None:
    trip_service.expire_stale_offers(db)
    now = utcnow()

    # Simulated riders accept offers after a short delay.
    accept_before = now - timedelta(seconds=settings.simulator_accept_delay_seconds)
    offered = db.scalars(
        select(Trip)
        .join(Rider, Rider.id == Trip.offered_rider_id)
        .where(Trip.status == "requested", Rider.is_simulated.is_(True), Trip.offered_at <= accept_before)
    ).all()
    for trip in offered:
        rider = db.get(Rider, trip.offered_rider_id)
        trip_service.accept(db, trip, rider)

    moving = db.scalars(select(Trip).where(Trip.status.in_(("accepted", "ongoing")))).all()
    for trip in moving:
        if trip.rider and trip_service.is_simulated(trip):
            _drive(db, trip)
    db.commit()


def _drive(db: Session, trip: Trip) -> None:
    rider = trip.rider
    speed = _speed_kmh(trip)
    step_km = speed * settings.simulator_tick_seconds / 3600 * settings.simulator_speedup

    if trip.status == "accepted":
        path = trip.approach or [[rider.current_lat, rider.current_lng], [trip.pickup_lat, trip.pickup_lng]]
        trip.sim_progress_km += step_km
        point, arrived = point_along(path, trip.sim_progress_km)
        trip_service.record_location(db, trip, rider, point, speed)
        if arrived:
            trip_service.start(db, trip)
        return

    plan = _plan_for(trip)
    route = trip.route
    total_km = max(trip.distance_km, 0.1)

    if plan.anomaly and not plan.triggered and trip.sim_progress_km / total_km >= plan.at_fraction:
        plan.triggered = True
        plan.ticks_left = 12 if plan.anomaly == "detour" else 30

    if plan.ticks_left > 0:
        plan.ticks_left -= 1
        point, _ = point_along(route, trip.sim_progress_km)
        if plan.anomaly == "detour":
            # Drift away from the route, then snap back when the detour ends.
            drift = (12 - plan.ticks_left) * 0.12
            trip_service.record_location(db, trip, rider, offset_point(point, drift, drift), speed)
        else:
            trip_service.record_location(db, trip, rider, point, 0.0)
        return

    trip.sim_progress_km += step_km
    point, arrived = point_along(route, trip.sim_progress_km)
    trip_service.record_location(db, trip, rider, point, speed)
    if arrived:
        trip_service.complete(db, trip)
        _plans.pop(trip.id, None)


def _tick_once() -> None:
    with SessionLocal() as db:
        try:
            tick(db)
        except Exception:
            db.rollback()
            log.exception("simulator tick failed")


async def run_forever() -> None:
    log.info("Trip simulator started (speedup x%s)", settings.simulator_speedup)
    while True:
        await asyncio.to_thread(_tick_once)
        await asyncio.sleep(settings.simulator_tick_seconds)
