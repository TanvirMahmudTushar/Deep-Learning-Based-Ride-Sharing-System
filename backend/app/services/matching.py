"""Cancellation-aware matching.

score = pickup ETA (min) + CANCEL_PENALTY_MIN * P(cancel). Lower is better, so a rider who is
two minutes further away but much less likely to cancel can outrank the nearest rider. The
proposal's system-level baseline (nearest available driver) is CANCEL_PENALTY_MIN = 0.
"""

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.models import MatchScore, Rider, Trip
from app.realtime import emit
from app.services import availability
from app.services.predictors import cancellation_predictor, eta_predictor, is_peak
from app.services.routing import DETOUR_FACTOR

CANCEL_PENALTY_MIN = 20.0


def rider_cancel_rates(db: Session, rider_ids: list[str]) -> dict[str, float]:
    if not rider_ids:
        return {}
    rows = db.execute(
        select(
            Trip.rider_id,
            func.count(),
            func.sum(case((Trip.cancelled_by == "rider", 1), else_=0)),
        )
        .where(Trip.rider_id.in_(rider_ids))
        .group_by(Trip.rider_id)
    ).all()
    # Laplace smoothing so a rider with no history gets a modest prior instead of 0.
    return {rid: (cancelled + 0.5) / (total + 10) for rid, total, cancelled in rows}


def rank_candidates(db: Session, trip: Trip) -> list[MatchScore]:
    tried = set(db.scalars(select(MatchScore.rider_id).where(MatchScore.trip_id == trip.id)))
    pickup = (trip.pickup_lat, trip.pickup_lng)
    riders = availability.free_riders_near(db, pickup, trip.vehicle_type_requested, settings.match_radius_km, exclude=tried)
    rates = rider_cancel_rates(db, [r.id for r in riders])
    now = utcnow()

    scored = []
    for r in riders:
        pickup_km = availability.distance_to(r, pickup) * DETOUR_FACTOR
        eta = eta_predictor.predict_eta(pickup_km, trip.vehicle_type_requested, now)
        p_cancel = cancellation_predictor.cancel_probability(
            pickup_km=pickup_km, trip_km=trip.distance_km, rider_cancel_rate=rates.get(r.id, 0.05), peak=is_peak(now)
        )
        scored.append((eta + CANCEL_PENALTY_MIN * p_cancel, eta, p_cancel, r))
    scored.sort(key=lambda s: s[0])

    start_rank = len(tried) + 1
    rows = [
        MatchScore(trip_id=trip.id, rider_id=r.id, pickup_eta_min=eta, cancel_probability=p, score=round(score, 3), rank=start_rank + i)
        for i, (score, eta, p, r) in enumerate(scored)
    ]
    db.add_all(rows)
    db.flush()
    return rows


def offer_next(db: Session, trip: Trip) -> bool:
    """Offer the trip to the best remaining candidate. Returns False when nobody is left."""
    busy = availability.busy_rider_ids(db) - {trip.offered_rider_id}
    for attempt in range(2):
        candidates = db.scalars(
            select(MatchScore).where(MatchScore.trip_id == trip.id, MatchScore.status == "candidate").order_by(MatchScore.rank)
        ).all()
        for ms in candidates:
            if ms.rider_id in busy:
                ms.status = "expired"
                continue
            ms.status = "offered"
            trip.offered_rider_id = ms.rider_id
            trip.offered_at = utcnow()
            trip.pickup_eta_min = ms.pickup_eta_min
            db.flush()
            rider = db.get(Rider, ms.rider_id)
            emit(
                db,
                rider.profile_id,
                "offer.new",
                notify=("New trip request", f"৳{float(trip.fare_estimate):.0f} · pickup {trip.pickup_address}"),
                trip_id=trip.id,
            )
            return True
        if attempt == 0:
            rank_candidates(db, trip)  # new riders may have come online since the first ranking
    trip.offered_rider_id = None
    trip.offered_at = None
    return False


def set_offer_status(db: Session, trip: Trip, rider_id: str, status: str) -> None:
    ms = db.scalar(select(MatchScore).where(MatchScore.trip_id == trip.id, MatchScore.rider_id == rider_id))
    if ms is not None:
        ms.status = status
