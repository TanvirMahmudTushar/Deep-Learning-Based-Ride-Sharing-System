"""Hourly weather from Open-Meteo, stored in weather_hourly for pricing and the demand model."""

import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.models import WeatherHourly

log = logging.getLogger(__name__)

RAIN_THRESHOLD_MM = 0.5


def refresh_weather(db: Session) -> int:
    """Fetch yesterday + today's hourly weather. Returns the number of rows stored."""
    if not settings.use_weather:
        return 0
    try:
        resp = httpx.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": settings.city_lat,
                "longitude": settings.city_lng,
                "hourly": "temperature_2m,precipitation",
                "past_days": 1,
                "forecast_days": 1,
                "timezone": "GMT",
            },
            timeout=6.0,
        )
        resp.raise_for_status()
        hourly = resp.json()["hourly"]
    except Exception as exc:
        log.warning("Open-Meteo unavailable: %s", exc)
        return 0

    existing = {w.observed_at: w for w in db.scalars(select(WeatherHourly).where(WeatherHourly.observed_at >= utcnow() - timedelta(days=2)))}
    stored = 0
    for t, temp, rain in zip(hourly["time"], hourly["temperature_2m"], hourly["precipitation"]):
        if temp is None or rain is None:
            continue
        at = datetime.fromisoformat(t)
        row = existing.get(at)
        if row is None:
            db.add(WeatherHourly(observed_at=at, temperature_c=temp, precipitation_mm=rain))
        else:
            row.temperature_c, row.precipitation_mm = temp, rain
        stored += 1
    db.commit()
    return stored


def current_weather(db: Session) -> WeatherHourly | None:
    hour = utcnow().replace(minute=0, second=0, microsecond=0)
    return db.scalar(
        select(WeatherHourly)
        .where(WeatherHourly.observed_at <= hour, WeatherHourly.observed_at >= hour - timedelta(hours=3))
        .order_by(WeatherHourly.observed_at.desc())
    )


def is_raining(db: Session) -> bool:
    w = current_weather(db)
    return bool(w and w.precipitation_mm >= RAIN_THRESHOLD_MM)
