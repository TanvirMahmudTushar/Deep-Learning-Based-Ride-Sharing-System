"""Admin dashboard endpoints: platform stats, rider verification, live trips, alerts, forecasts, pricing."""

from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db import local_day_start, local_time, utcnow
from app.geo import haversine_km
from app.models import ACTIVE_TRIP_STATUSES, VEHICLE_TYPES, DemandForecast, PricingRule, Rider, SafetyAlert, Trip
from app.schemas import AlertStatusIn, PricingRuleIn, iso_utc, rider_rating, trip_out, vehicle_out
from app.security import DB, Admin
from app.realtime import ADMINS, emit
from app.services import availability, demand, documents
from app.services import trips as trip_service
from app.services.alerts import ensure_summary
from app.services.predictors import demand_forecaster
from app.services.weather import current_weather, is_raining
from app.services.zones import all_zones

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/stats")
def stats(db: DB, admin: Admin):
    today = local_day_start()
    week = utcnow() - timedelta(days=7)

    def count(*where) -> int:
        return db.scalar(select(func.count(Trip.id)).where(*where)) or 0

    trips_week = count(Trip.requested_at >= week)
    cancelled_week = count(Trip.requested_at >= week, Trip.status == "cancelled")
    rider_cancels_week = count(Trip.requested_at >= week, Trip.cancelled_by == "rider")

    completed = db.execute(
        select(Trip.predicted_eta_min, Trip.actual_duration_min, Trip.pickup_eta_min).where(
            Trip.completed_at >= week, Trip.status == "completed", Trip.actual_duration_min.is_not(None)
        )
    ).all()
    eta_errors = [abs(p - a) for p, a, _ in completed]
    waits = [w for _, _, w in completed if w is not None]

    online = db.scalars(select(Rider).where(Rider.is_online.is_(True)).options(selectinload(Rider.vehicles))).all()
    busy = availability.busy_rider_ids(db)
    online_by_type: dict[str, int] = defaultdict(int)
    for r in online:
        if r.vehicle:
            online_by_type[r.vehicle.vehicle_type] += 1

    weather = current_weather(db)
    return {
        "trips_today": count(Trip.requested_at >= today),
        "completed_today": count(Trip.requested_at >= today, Trip.status == "completed"),
        "active_trips": count(Trip.status.in_(ACTIVE_TRIP_STATUSES)),
        "revenue_today": float(
            db.scalar(select(func.sum(Trip.fare_final)).where(Trip.requested_at >= today, Trip.status == "completed")) or 0
        ),
        "cancel_rate_7d": round(cancelled_week / trips_week, 3) if trips_week else 0.0,
        "rider_cancel_rate_7d": round(rider_cancels_week / trips_week, 3) if trips_week else 0.0,
        "avg_pickup_wait_min_7d": round(sum(waits) / len(waits), 1) if waits else None,
        "eta_mae_min_7d": round(sum(eta_errors) / len(eta_errors), 2) if eta_errors else None,
        "online_riders": len(online),
        "busy_riders": sum(1 for r in online if r.id in busy),
        "online_by_type": {vt: online_by_type.get(vt, 0) for vt in VEHICLE_TYPES},
        "pending_riders": db.scalar(select(func.count(Rider.id)).where(Rider.status == "pending")) or 0,
        "open_alerts": db.scalar(select(func.count(SafetyAlert.id)).where(SafetyAlert.status == "open")) or 0,
        "weather": {"temperature_c": weather.temperature_c, "precipitation_mm": weather.precipitation_mm, "raining": is_raining(db)}
        if weather
        else None,
    }


@router.get("/riders")
def riders(db: DB, admin: Admin, status_filter: str | None = None):
    q = select(Rider).options(selectinload(Rider.vehicles), selectinload(Rider.profile)).order_by(Rider.is_simulated, Rider.status)
    if status_filter:
        q = q.where(Rider.status == status_filter)
    busy = availability.busy_rider_ids(db)
    out = []
    for r in db.scalars(q):
        rating, n = rider_rating(db, r.id)
        out.append(
            {
                "id": r.id,
                "full_name": r.profile.full_name,
                "email": r.profile.email,
                "phone": r.profile.phone,
                "license_no": r.license_no,
                "status": r.status,
                "is_online": r.is_online,
                "is_simulated": r.is_simulated,
                "busy": r.id in busy,
                "lat": r.current_lat,
                "lng": r.current_lng,
                "rating": rating,
                "rating_count": n,
                "vehicle": vehicle_out(r.vehicle).model_dump() if r.vehicle else None,
                "documents_ready": documents.verification_ready(db, r)[0],
                "joined_at": iso_utc(r.profile.created_at),
            }
        )
    return out


def _rider_or_404(db: DB, rider_id: str) -> Rider:
    rider = db.get(Rider, rider_id)
    if rider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider not found")
    return rider


@router.post("/riders/{rider_id}/verify")
def verify_rider(rider_id: str, db: DB, admin: Admin):
    rider = _rider_or_404(db, rider_id)
    ready, missing = documents.verification_ready(db, rider)
    if not ready:
        raise HTTPException(status.HTTP_409_CONFLICT, "Approve these documents first: " + ", ".join(missing))
    rider.status = "verified"
    for v in rider.vehicles:
        v.verified = True
    emit(db, rider.profile_id, "profile.updated", notify=("You're verified", "You can go online and start accepting trips."))
    emit(db, ADMINS, "riders.changed")
    db.commit()
    return {"ok": True, "status": rider.status}


@router.post("/riders/{rider_id}/suspend")
def suspend_rider(rider_id: str, db: DB, admin: Admin):
    rider = _rider_or_404(db, rider_id)
    if trip_service.active_trip_for_rider(db, rider.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Rider is on a trip; suspend after it ends")
    rider.status = "suspended"
    rider.is_online = False
    emit(db, rider.profile_id, "profile.updated", notify=("Account suspended", "Contact support for details."))
    emit(db, ADMINS, "riders.changed")
    db.commit()
    return {"ok": True, "status": rider.status}


@router.get("/trips/live")
def live_trips(db: DB, admin: Admin):
    trips = db.scalars(select(Trip).where(Trip.status.in_(ACTIVE_TRIP_STATUSES)).order_by(Trip.requested_at.desc()))
    busy = availability.busy_rider_ids(db)
    online = db.scalars(select(Rider).where(Rider.is_online.is_(True)).options(selectinload(Rider.vehicles)))
    return {
        "trips": [trip_out(db, t).model_dump(mode="json") for t in trips],
        "riders": [
            {
                "id": r.id,
                "lat": r.current_lat,
                "lng": r.current_lng,
                "vehicle_type": r.vehicle.vehicle_type if r.vehicle else None,
                "busy": r.id in busy,
            }
            for r in online
            if r.current_lat is not None
        ],
    }


@router.get("/trips/recent")
def recent_trips(db: DB, admin: Admin, limit: int = 50):
    trips = db.scalars(select(Trip).order_by(Trip.requested_at.desc()).limit(min(limit, 200)))
    return [trip_out(db, t, include_route=False).model_dump(mode="json") for t in trips]


def _alert_out(db: DB, a: SafetyAlert) -> dict:
    return {
        "id": a.id,
        "trip_id": a.trip_id,
        "alert_type": a.alert_type,
        "anomaly_score": a.anomaly_score,
        "details": a.details,
        "summary": a.summary,
        "status": a.status,
        "created_at": iso_utc(a.created_at),
        "trip_status": a.trip.status,
        "vehicle_type": a.trip.vehicle_type_requested,
        "pickup_address": a.trip.pickup_address,
        "drop_address": a.trip.drop_address,
        "route": a.trip.route,
        "rider_name": a.trip.rider.profile.full_name if a.trip.rider else None,
    }


@router.get("/alerts")
def alerts(db: DB, admin: Admin, status_filter: str | None = None):
    q = select(SafetyAlert).order_by(SafetyAlert.created_at.desc()).limit(100)
    if status_filter:
        q = q.where(SafetyAlert.status == status_filter)
    return [_alert_out(db, a) for a in db.scalars(q)]


def _alert_or_404(db: DB, alert_id: str) -> SafetyAlert:
    alert = db.get(SafetyAlert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    return alert


@router.post("/alerts/{alert_id}/summarize")
def summarize(alert_id: str, db: DB, admin: Admin):
    alert = _alert_or_404(db, alert_id)
    ensure_summary(db, alert)
    return _alert_out(db, alert)


@router.post("/alerts/{alert_id}/status")
def set_alert_status(alert_id: str, body: AlertStatusIn, db: DB, admin: Admin):
    alert = _alert_or_404(db, alert_id)
    alert.status = body.status
    alert.reviewed_by = admin.id
    db.commit()
    return _alert_out(db, alert)


@router.get("/forecasts")
def forecasts(db: DB, admin: Admin):
    demand.ensure_fresh(db)
    zones = all_zones(db)
    rows = db.scalars(select(DemandForecast)).all()

    next_hour: dict[int, dict[str, float]] = defaultdict(lambda: {vt: 0.0 for vt in VEHICLE_TYPES})
    for f in rows:
        next_hour[f.zone_id][f.vehicle_type] += f.predicted_requests

    # Today's hourly profile: forecast (all zones) vs actual requests so far.
    today = local_day_start()
    raining = is_raining(db)
    actual: dict[int, int] = defaultdict(int)
    for (at,) in db.execute(select(Trip.requested_at).where(Trip.requested_at >= today)):
        actual[local_time(at).hour] += 1
    now_hour = local_time(utcnow()).hour
    hourly = []
    for h in range(24):
        at = today + timedelta(hours=h)
        predicted = sum(
            demand_forecaster.forecast(z.id, vt, at + timedelta(minutes=15 * s), raining) for z in zones for vt in VEHICLE_TYPES for s in range(4)
        )
        hourly.append({"hour": h, "forecast": round(predicted, 1), "actual": actual.get(h, 0) if h <= now_hour else None})

    busy = availability.busy_rider_ids(db)
    supply: dict[int, int] = defaultdict(int)
    zone_points = [(z.id, (z.center_lat, z.center_lng)) for z in zones]
    for r in db.scalars(select(Rider).where(Rider.is_online.is_(True), Rider.current_lat.is_not(None))):
        if r.id in busy:
            continue
        zid = min(zone_points, key=lambda zp: haversine_km(zp[1], (r.current_lat, r.current_lng)))[0]
        supply[zid] += 1

    return {
        "model": demand_forecaster.name,
        "generated_at": iso_utc(demand.last_refresh()),
        "raining": raining,
        "zones": [
            {
                "zone_id": z.id,
                "zone": z.name,
                "lat": z.center_lat,
                "lng": z.center_lng,
                **{vt: round(next_hour[z.id][vt], 2) for vt in VEHICLE_TYPES},
                "total": round(sum(next_hour[z.id].values()), 2),
                "free_riders": supply.get(z.id, 0),
            }
            for z in zones
        ],
        "hourly": hourly,
    }


@router.post("/forecasts/refresh")
def refresh_forecasts(db: DB, admin: Admin):
    n = demand.refresh_forecasts(db)
    return {"ok": True, "rows": n}


def _rule_out(r: PricingRule) -> dict:
    return {
        "id": r.id,
        "vehicle_type": r.vehicle_type,
        "base_fare": float(r.base_fare),
        "per_km": float(r.per_km),
        "per_min": float(r.per_min),
        "min_fare": float(r.min_fare),
        "max_multiplier": r.max_multiplier,
        "commission_pct": r.commission_pct if r.commission_pct is not None else settings.default_commission_pct,
    }


@router.get("/pricing")
def pricing_rules(db: DB, admin: Admin):
    return [_rule_out(r) for r in db.scalars(select(PricingRule).order_by(PricingRule.id))]


@router.put("/pricing/{vehicle_type}")
def update_pricing(vehicle_type: str, body: PricingRuleIn, db: DB, admin: Admin):
    rule = db.scalar(select(PricingRule).where(PricingRule.vehicle_type == vehicle_type))
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown vehicle type")
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    db.commit()
    return _rule_out(rule)
