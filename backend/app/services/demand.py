"""Demand forecasts per zone and vehicle type for the next hour, in 15-minute slots."""

import threading
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import local_day_start, utcnow
from app.models import VEHICLE_TYPES, DemandForecast, Trip
from app.services.predictors import HistoricalTrip, demand_forecaster
from app.services.weather import is_raining
from app.services.zones import all_zones

HISTORY_DAYS = 28
SLOTS = 4
REFRESH_EVERY = timedelta(minutes=15)

_lock = threading.Lock()
_last_refresh: datetime | None = None


def slot_start(at: datetime) -> datetime:
    return at.replace(minute=at.minute - at.minute % 15, second=0, microsecond=0)


def fit_forecaster(db: Session) -> None:
    # Whole days only: a partial today would drag every hour's average down.
    today = local_day_start()
    rows = db.execute(
        select(Trip.pickup_zone_id, Trip.vehicle_type_requested, Trip.requested_at).where(
            Trip.requested_at >= today - timedelta(days=HISTORY_DAYS),
            Trip.requested_at < today,
            Trip.pickup_zone_id.is_not(None),
        )
    ).all()
    demand_forecaster.fit(HistoricalTrip(z, vt, at) for z, vt, at in rows)


def refresh_forecasts(db: Session) -> int:
    """Refit the forecaster on recent trips and replace the stored forecasts."""
    global _last_refresh
    with _lock:
        fit_forecaster(db)
        raining = is_raining(db)
        start = slot_start(utcnow())
        db.execute(delete(DemandForecast))
        rows = [
            DemandForecast(
                zone_id=zone.id,
                vehicle_type=vt,
                forecast_for=start + timedelta(minutes=15 * i),
                predicted_requests=demand_forecaster.forecast(zone.id, vt, start + timedelta(minutes=15 * i), raining),
                model_version=demand_forecaster.name,
            )
            for zone in all_zones(db)
            for vt in VEHICLE_TYPES
            for i in range(SLOTS)
        ]
        db.add_all(rows)
        db.commit()
        _last_refresh = utcnow()
        return len(rows)


def ensure_fresh(db: Session) -> None:
    if _last_refresh is None or utcnow() - _last_refresh > REFRESH_EVERY:
        refresh_forecasts(db)


def expected_next_hour(db: Session, zone_id: int, vehicle_type: str) -> float:
    ensure_fresh(db)
    total = db.scalar(
        select(func.sum(DemandForecast.predicted_requests)).where(
            DemandForecast.zone_id == zone_id, DemandForecast.vehicle_type == vehicle_type
        )
    )
    return float(total or 0.0)


def last_refresh() -> datetime | None:
    return _last_refresh
