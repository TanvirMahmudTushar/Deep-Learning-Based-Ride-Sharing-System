"""Safety checks on live GPS pings: route deviation and long stops."""

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.geo import Point, distance_to_polyline_km, haversine_km
from app.models import SafetyAlert, Trip, TripLocation
from app.realtime import ADMINS, emit
from app.services.groq_client import summarize_alert
from app.services.predictors import anomaly_detector

MOVING_SPEED_KMH = 2.0


def _has_alert(db: Session, trip_id: str, alert_type: str) -> bool:
    return db.scalar(select(SafetyAlert.id).where(SafetyAlert.trip_id == trip_id, SafetyAlert.alert_type == alert_type)) is not None


def _progress_pct(trip: Trip, p: Point) -> int:
    total = haversine_km((trip.pickup_lat, trip.pickup_lng), (trip.drop_lat, trip.drop_lng))
    done = haversine_km((trip.pickup_lat, trip.pickup_lng), p)
    return int(min(100, 100 * done / total)) if total > 0 else 0


def check_location(db: Session, trip: Trip, p: Point, speed_kmh: float, time_scale: float) -> SafetyAlert | None:
    """Run the anomaly detector on one ping. `time_scale` converts real seconds to simulated seconds."""
    route = trip.route
    if trip.status != "ongoing" or len(route) < 2:
        return None

    deviation = distance_to_polyline_km(p, route)
    score = anomaly_detector.score(deviation)
    base = {"vehicle_type": trip.vehicle_type_requested, "progress_pct": _progress_pct(trip, p), "lat": round(p[0], 5), "lng": round(p[1], 5)}

    if score >= 1 and not _has_alert(db, trip.id, "route_deviation"):
        return _create(db, trip, "route_deviation", score, {**base, "deviation_km": round(deviation, 2)})

    if speed_kmh < MOVING_SPEED_KMH and not _has_alert(db, trip.id, "long_stop"):
        last_moving = db.scalar(
            select(TripLocation.recorded_at)
            .where(TripLocation.trip_id == trip.id, TripLocation.speed_kmh >= MOVING_SPEED_KMH)
            .order_by(TripLocation.recorded_at.desc())
        )
        since = max(filter(None, [last_moving, trip.started_at]))
        stopped_min = (utcnow() - since).total_seconds() / 60 * time_scale
        if stopped_min >= anomaly_detector.LONG_STOP_MINUTES:
            stop_score = round(stopped_min / anomaly_detector.LONG_STOP_MINUTES, 3)
            return _create(db, trip, "long_stop", stop_score, {**base, "stop_minutes": round(stopped_min, 1)})
    return None


def _create(db: Session, trip: Trip, alert_type: str, score: float, details: dict) -> SafetyAlert:
    alert = SafetyAlert(trip_id=trip.id, alert_type=alert_type, anomaly_score=score, details_json=json.dumps(details))
    db.add(alert)
    db.flush()
    notify = None
    if alert_type == "sos":
        notify = ("Passenger SOS", f"Emergency on a {trip.vehicle_type_requested} trip from {trip.pickup_address}.")
    emit(db, ADMINS, "alert.new", notify=notify, alert_id=alert.id, alert_type=alert_type)
    return alert


def raise_sos(db: Session, trip: Trip, note: str) -> SafetyAlert:
    """Passenger emergency button. One open SOS per trip; pressing again returns the same alert."""
    existing = db.scalar(select(SafetyAlert).where(SafetyAlert.trip_id == trip.id, SafetyAlert.alert_type == "sos", SafetyAlert.status == "open"))
    if existing:
        return existing
    p = (trip.rider.current_lat, trip.rider.current_lng) if trip.rider and trip.rider.current_lat is not None else (trip.pickup_lat, trip.pickup_lng)
    details = {
        "vehicle_type": trip.vehicle_type_requested,
        "progress_pct": _progress_pct(trip, p) if trip.status == "ongoing" else 0,
        "lat": round(p[0], 5),
        "lng": round(p[1], 5),
        "trip_status": trip.status,
        "note": note.strip(),
    }
    # Highest priority: score well above the detector's alert threshold.
    return _create(db, trip, "sos", 10.0, details)


def file_report(db: Session, trip: Trip, category: str, note: str) -> SafetyAlert:
    details = {"vehicle_type": trip.vehicle_type_requested, "category": category, "note": note.strip(), "trip_status": trip.status}
    return _create(db, trip, "report", 0.0, details)


def ensure_summary(db: Session, alert: SafetyAlert) -> str:
    if not alert.summary:
        alert.summary = summarize_alert({"alert_type": alert.alert_type, "anomaly_score": alert.anomaly_score, **alert.details})
        db.commit()
    return alert.summary
