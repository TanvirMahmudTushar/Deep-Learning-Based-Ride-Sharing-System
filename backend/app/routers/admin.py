"""Admin dashboard endpoints: platform stats, rider verification, live trips, alerts, forecasts, pricing."""

import json
from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db import local_day_start, local_time, utcnow
from app.geo import haversine_km
from app.models import ACTIVE_TRIP_STATUSES, VEHICLE_TYPES, DemandForecast, PricingRule, PricingRuleChange, Profile, Rider, SafetyAlert, Trip, TripLocation
from app.schemas import (
    AdminAccountOut,
    AdminAccountPageOut,
    AdminAccountTripPageOut,
    AlertStatusIn,
    PricingRuleIn,
    iso_utc,
    rider_rating,
    trip_out,
    vehicle_out,
)
from app.security import DB, Admin, account_is_suspended
from app.realtime import ADMINS, emit
from app.services import availability, demand, documents
from app.services import trips as trip_service
from app.services.alert_severity import anomaly_severity
from app.services.alerts import ensure_summary
from app.services.predictors import active_demand_model, demand_baseline_forecaster, predict_demand
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
        "pending_riders": db.scalar(
            select(func.count(Rider.id))
            .join(Profile, Profile.id == Rider.profile_id)
            .where(
                Rider.status == "pending",
                or_(Profile.account_status.is_(None), Profile.account_status == "active"),
            )
        )
        or 0,
        "open_alerts": db.scalar(select(func.count(SafetyAlert.id)).where(SafetyAlert.status == "open")) or 0,
        "weather": {"temperature_c": weather.temperature_c, "precipitation_mm": weather.precipitation_mm, "raining": is_raining(db)}
        if weather
        else None,
    }


@router.get("/riders")
def riders(db: DB, admin: Admin, status_filter: str | None = None):
    q = select(Rider).options(selectinload(Rider.vehicles), selectinload(Rider.profile)).order_by(Rider.is_simulated, Rider.status)
    if status_filter and status_filter != "all":
        if status_filter not in {"pending", "verified", "suspended"}:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown rider status")
        q = q.join(Profile, Profile.id == Rider.profile_id)
        if status_filter == "suspended":
            q = q.where(or_(Profile.account_status == "suspended", Rider.status == "suspended"))
        else:
            q = q.where(
                Rider.status == status_filter,
                or_(Profile.account_status.is_(None), Profile.account_status == "active"),
            )
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
                "status": "suspended" if account_is_suspended(r.profile) else r.status,
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


def _account_trip_stats(db: DB, owner_column, owner_ids: list[str], cancellation_actor: str) -> dict[str, dict[str, int | float]]:
    if not owner_ids:
        return {}
    rows = db.execute(
        select(
            owner_column,
            func.count(Trip.id),
            func.sum(case((Trip.status == "completed", 1), else_=0)),
            func.sum(case((Trip.status == "cancelled", 1), else_=0)),
            func.sum(case((Trip.cancelled_by == cancellation_actor, 1), else_=0)),
        )
        .where(owner_column.in_(owner_ids))
        .group_by(owner_column)
    ).all()
    stats = {}
    for owner_id, trips_total, completed, cancelled, account_cancellations in rows:
        total = int(trips_total or 0)
        cancellations = int(account_cancellations or 0)
        stats[owner_id] = {
            "trips_total": total,
            "trips_completed": int(completed or 0),
            "trips_cancelled": int(cancelled or 0),
            "account_cancellations": cancellations,
            "cancellation_rate": cancellations / total if total else 0.0,
        }
    return stats


@router.get("/accounts", response_model=AdminAccountPageOut)
def admin_accounts(
    db: DB,
    admin: Admin,
    search: str | None = None,
    role_filter: str = "all",
    status_filter: str = "all",
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    if role_filter not in {"all", "user", "rider"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown account role")
    if status_filter not in {"all", "active", "pending", "verified", "suspended"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown account status")

    filters = [Profile.role.in_(("user", "rider"))]
    if role_filter != "all":
        filters.append(Profile.role == role_filter)

    active_account = or_(Profile.account_status.is_(None), Profile.account_status == "active")
    suspended_account = or_(Profile.account_status == "suspended", Rider.status == "suspended")
    if status_filter == "suspended":
        filters.append(suspended_account)
    elif status_filter == "active":
        filters.extend((active_account, or_(Profile.role == "user", Rider.status == "verified")))
    elif status_filter == "pending":
        filters.extend((active_account, Profile.role == "rider", Rider.status == "pending"))
    elif status_filter == "verified":
        filters.extend((active_account, Profile.role == "rider", Rider.status == "verified"))

    if search and search.strip():
        term = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{term}%"
        filters.append(
            or_(
                Profile.full_name.ilike(pattern, escape="\\"),
                Profile.email.ilike(pattern, escape="\\"),
                Profile.id.ilike(pattern, escape="\\"),
                Rider.id.ilike(pattern, escape="\\"),
                Rider.license_no.ilike(pattern, escape="\\"),
            )
        )

    total = db.scalar(select(func.count(Profile.id)).outerjoin(Rider, Rider.profile_id == Profile.id).where(*filters)) or 0
    profiles = db.scalars(
        select(Profile)
        .outerjoin(Rider, Rider.profile_id == Profile.id)
        .options(selectinload(Profile.rider).selectinload(Rider.vehicles))
        .where(*filters)
        .order_by(Profile.created_at.desc(), Profile.id)
        .offset(offset)
        .limit(limit)
    ).all()

    riders_page = [p.rider for p in profiles if p.rider is not None]
    user_stats = _account_trip_stats(db, Trip.user_id, [p.id for p in profiles if p.role == "user"], "user")
    rider_stats = _account_trip_stats(db, Trip.rider_id, [r.id for r in riders_page], "rider")
    busy = availability.busy_rider_ids(db)
    items = []
    for profile in profiles:
        rider = profile.rider
        suspended = account_is_suspended(profile)
        stats = (rider_stats.get(rider.id) if rider else None) or (user_stats.get(profile.id) if profile.role == "user" else None)
        if stats is None:
            stats = {"trips_total": 0, "trips_completed": 0, "trips_cancelled": 0, "account_cancellations": 0, "cancellation_rate": 0.0}
        rating, rating_count = rider_rating(db, rider.id) if rider else (None, 0)
        items.append(
            {
                "id": profile.id,
                "role": profile.role,
                "full_name": profile.full_name,
                "email": profile.email,
                "phone": profile.phone,
                "status": "suspended" if suspended else (rider.status if rider else "active"),
                "account_status": "suspended" if suspended else "active",
                "rider_verification_status": (
                    rider.status if rider and rider.status in {"pending", "verified"} else ("verified" if rider else None)
                ),
                "rider_id": rider.id if rider else None,
                "license_no": rider.license_no if rider else None,
                "is_simulated": rider.is_simulated if rider else False,
                "is_online": rider.is_online if rider else False,
                "busy": rider.id in busy if rider else False,
                "lat": rider.current_lat if rider else None,
                "lng": rider.current_lng if rider else None,
                "rating": rating,
                "rating_count": rating_count,
                "vehicle": vehicle_out(rider.vehicle).model_dump() if rider and rider.vehicle else None,
                "documents_ready": documents.verification_ready(db, rider)[0] if rider else False,
                "joined_at": iso_utc(profile.created_at),
                "stats": stats,
            }
        )
    return {"items": items, "total": total}


@router.get("/accounts/{account_id}/trips", response_model=AdminAccountTripPageOut)
def admin_account_trips(
    account_id: str,
    db: DB,
    admin: Admin,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    profile = db.get(Profile, account_id)
    if profile is None or profile.role not in {"user", "rider"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    if profile.role == "user":
        owner_column, owner_id = Trip.user_id, profile.id
    else:
        if profile.rider is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider profile not found")
        owner_column, owner_id = Trip.rider_id, profile.rider.id
    base = select(Trip).where(owner_column == owner_id)
    total = db.scalar(select(func.count(Trip.id)).where(owner_column == owner_id)) or 0
    trips = db.scalars(base.order_by(Trip.requested_at.desc(), Trip.id).offset(offset).limit(limit + 1)).all()
    has_more = len(trips) > limit
    return {
        "items": [
            {
                "id": trip.id,
                "status": trip.status,
                "vehicle_type": trip.vehicle_type_requested,
                "pickup_address": trip.pickup_address,
                "drop_address": trip.drop_address,
                "distance_km": trip.distance_km,
                "fare_estimate": float(trip.fare_estimate),
                "fare_final": float(trip.fare_final) if trip.fare_final is not None else None,
                "requested_at": iso_utc(trip.requested_at),
                "completed_at": iso_utc(trip.completed_at),
                "cancelled_by": trip.cancelled_by,
                "cancel_reason": trip.cancel_reason,
            }
            for trip in trips[:limit]
        ],
        "total": total,
        "has_more": has_more,
    }


def _set_account_status(db: DB, profile: Profile, suspended: bool) -> dict:
    if profile.role not in {"user", "rider"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    rider = profile.rider
    if profile.role == "rider" and rider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider profile not found")
    if rider and rider.is_simulated:
        raise HTTPException(status.HTTP_409_CONFLICT, "Simulated accounts cannot be suspended or reactivated")

    if suspended:
        if account_is_suspended(profile):
            profile.account_status = "suspended"
            db.commit()
            return {"ok": True, "account_status": "suspended", "status": "suspended"}
        if profile.role == "user":
            active_trip = trip_service.active_trip_for_user(db, profile.id)
        else:
            active_trip = db.scalar(
                select(Trip.id)
                .where(
                    Trip.status.in_(ACTIVE_TRIP_STATUSES),
                    or_(Trip.rider_id == rider.id, Trip.offered_rider_id == rider.id),
                )
                .limit(1)
            )
        if active_trip:
            raise HTTPException(status.HTTP_409_CONFLICT, "Finish the active trip before suspending this account")
        profile.account_status = "suspended"
        if rider:
            rider.is_online = False
        emit(db, profile.id, "account.suspended", notify=("Account suspended", "Contact support for details."))
        emit(db, ADMINS, "riders.changed")
        db.commit()
        return {"ok": True, "account_status": "suspended", "status": "suspended"}

    was_suspended = account_is_suspended(profile)
    if was_suspended:
        profile.account_status = "active"
        if rider and rider.status == "suspended":
            rider.status = "verified"
        emit(db, profile.id, "profile.updated", notify=("Account reactivated", "You can sign in and use your account again."))
        emit(db, ADMINS, "riders.changed")
        db.commit()
    status_value = rider.status if rider else "active"
    return {"ok": True, "account_status": "active", "status": status_value}


@router.post("/accounts/{account_id}/suspend")
def suspend_account(account_id: str, db: DB, admin: Admin):
    profile = db.get(Profile, account_id)
    if profile is None or profile.role not in {"user", "rider"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    return _set_account_status(db, profile, suspended=True)


@router.post("/accounts/{account_id}/reactivate")
def reactivate_account(account_id: str, db: DB, admin: Admin):
    profile = db.get(Profile, account_id)
    if profile is None or profile.role not in {"user", "rider"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    return _set_account_status(db, profile, suspended=False)


def _rider_or_404(db: DB, rider_id: str) -> Rider:
    rider = db.get(Rider, rider_id)
    if rider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider not found")
    return rider


@router.post("/riders/{rider_id}/verify")
def verify_rider(rider_id: str, db: DB, admin: Admin):
    rider = _rider_or_404(db, rider_id)
    if account_is_suspended(rider.profile):
        raise HTTPException(status.HTTP_409_CONFLICT, "Reactivate this account before verifying the rider")
    ready, missing = documents.verification_ready(db, rider)
    if not ready:
        raise HTTPException(status.HTTP_409_CONFLICT, "Approve these documents first: " + ", ".join(missing))
    rider.status = "verified"
    rider.profile.account_status = "active"
    for v in rider.vehicles:
        v.verified = True
    emit(db, rider.profile_id, "profile.updated", notify=("You're verified", "You can go online and start accepting trips."))
    emit(db, ADMINS, "riders.changed")
    db.commit()
    return {"ok": True, "status": rider.status}


@router.post("/riders/{rider_id}/suspend")
def suspend_rider(rider_id: str, db: DB, admin: Admin):
    rider = _rider_or_404(db, rider_id)
    return _set_account_status(db, rider.profile, suspended=True)


@router.get("/trips/live")
def live_trips(db: DB, admin: Admin):
    trips = db.scalars(select(Trip).where(Trip.status.in_(ACTIVE_TRIP_STATUSES)).order_by(Trip.requested_at.desc())).all()
    busy = availability.busy_rider_ids(db)
    online = db.scalars(select(Rider).where(Rider.is_online.is_(True)).options(selectinload(Rider.vehicles)))
    trace_by_trip: dict[str, list[list[float]]] = defaultdict(list)
    if trips:
        locations = db.execute(
            select(TripLocation.trip_id, TripLocation.lat, TripLocation.lng)
            .where(TripLocation.trip_id.in_([trip.id for trip in trips]))
            .order_by(TripLocation.trip_id, TripLocation.recorded_at, TripLocation.id)
        )
        for trip_id, lat, lng in locations:
            trace_by_trip[trip_id].append([lat, lng])
    return {
        "trips": [
            {**trip_out(db, t).model_dump(mode="json"), "gps_trace": trace_by_trip[t.id]}
            for t in trips
        ],
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
        "severity": anomaly_severity(a.anomaly_score) if a.alert_type in {"route_deviation", "long_stop"} else None,
        "details": a.details,
        "summary": a.summary,
        "resolution_note": a.resolution_note,
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
        q = q.where(SafetyAlert.status == ("closed" if status_filter == "resolved" else status_filter))
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
    if body.status == "closed" and not (body.resolution_note or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A resolution note is required")
    alert = _alert_or_404(db, alert_id)
    alert.status = body.status
    alert.reviewed_by = admin.id
    if body.resolution_note is not None:
        alert.resolution_note = body.resolution_note.strip() or None
    db.commit()
    return _alert_out(db, alert)


@router.get("/forecasts")
def forecasts(db: DB, admin: Admin, horizon_minutes: int = Query(default=60, ge=15, le=60)):
    if horizon_minutes not in (15, 30, 60):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "horizon_minutes must be 15, 30, or 60")

    demand.ensure_fresh(db)
    zones = all_zones(db)
    model = active_demand_model()
    start = demand.forecast_start()
    end = start + timedelta(minutes=horizon_minutes)
    raining = is_raining(db)
    rows = db.scalars(
        select(DemandForecast).where(DemandForecast.forecast_for >= start, DemandForecast.forecast_for < end)
    ).all()

    window_predictions: dict[int, dict[str, float]] = defaultdict(lambda: {vt: 0.0 for vt in VEHICLE_TYPES})
    baseline_predictions = {vt: 0.0 for vt in VEHICLE_TYPES}
    for f in rows:
        window_predictions[f.zone_id][f.vehicle_type] += f.predicted_requests
        baseline_predictions[f.vehicle_type] += (
            f.predicted_requests
            if model.name == demand_baseline_forecaster.name
            else predict_demand(demand_baseline_forecaster, f.zone_id, f.vehicle_type, f.forecast_for, raining)
        )

    today = local_day_start()
    actual: dict[int, dict[str, int]] = defaultdict(lambda: {vt: 0 for vt in VEHICLE_TYPES})
    for at, vehicle_type in db.execute(
        select(Trip.requested_at, Trip.vehicle_type_requested).where(Trip.requested_at >= today)
    ):
        if vehicle_type in VEHICLE_TYPES:
            actual[local_time(at).hour][vehicle_type] += 1

    now_hour = local_time(utcnow()).hour
    hourly = []
    baseline_errors: dict[str, list[float]] = {"all": [], **{vt: [] for vt in VEHICLE_TYPES}}
    model_errors: dict[str, list[float]] = {"all": [], **{vt: [] for vt in VEHICLE_TYPES}}

    def hourly_predictions(forecaster, at) -> dict[str, float]:
        return {
            vt: round(
                sum(
                    predict_demand(forecaster, z.id, vt, at + timedelta(minutes=15 * slot), raining)
                    for z in zones
                    for slot in range(4)
                ),
                1,
            )
            for vt in VEHICLE_TYPES
        }

    for h in range(24):
        at = today + timedelta(hours=h)
        baseline_by_vehicle = hourly_predictions(demand_baseline_forecaster, at)
        model_by_vehicle = (
            baseline_by_vehicle if model.name == demand_baseline_forecaster.name else hourly_predictions(model, at)
        )
        observed = actual[h] if h <= now_hour else None
        hourly.append(
            {
                "hour": h,
                "forecast": round(sum(model_by_vehicle.values()), 1),
                "forecast_by_vehicle": model_by_vehicle,
                "actual": sum(observed.values()) if observed is not None else None,
                "actual_by_vehicle": observed,
            }
        )
        if h < now_hour:
            actual_by_vehicle = actual[h]
            baseline_errors["all"].append(sum(baseline_by_vehicle.values()) - sum(actual_by_vehicle.values()))
            model_errors["all"].append(sum(model_by_vehicle.values()) - sum(actual_by_vehicle.values()))
            for vt in VEHICLE_TYPES:
                baseline_errors[vt].append(baseline_by_vehicle[vt] - actual_by_vehicle[vt])
                model_errors[vt].append(model_by_vehicle[vt] - actual_by_vehicle[vt])

    def summarize_errors(errors: list[float]) -> dict:
        if not errors:
            return {"mae": None, "rmse": None, "evaluated_hours": 0}
        return {
            "mae": round(sum(abs(error) for error in errors) / len(errors), 2),
            "rmse": round((sum(error * error for error in errors) / len(errors)) ** 0.5, 2),
            "evaluated_hours": len(errors),
        }

    def model_metrics(errors: dict[str, list[float]]) -> dict:
        return {
            "all": summarize_errors(errors["all"]),
            "by_vehicle": {vt: summarize_errors(errors[vt]) for vt in VEHICLE_TYPES},
        }

    busy = availability.busy_rider_ids(db)
    supply: dict[int, dict[str, int]] = defaultdict(lambda: {vt: 0 for vt in VEHICLE_TYPES})
    zone_points = [(z.id, (z.center_lat, z.center_lng)) for z in zones]
    riders = db.scalars(
        select(Rider)
        .options(selectinload(Rider.vehicles))
        .where(Rider.is_online.is_(True), Rider.current_lat.is_not(None))
    )
    for r in riders:
        if r.id in busy:
            continue
        vehicle = r.vehicle
        if vehicle is None or vehicle.vehicle_type not in VEHICLE_TYPES:
            continue
        zid = min(zone_points, key=lambda zp: haversine_km(zp[1], (r.current_lat, r.current_lng)))[0]
        supply[zid][vehicle.vehicle_type] += 1

    active_by_vehicle = {
        vt: round(sum(window_predictions[z.id][vt] for z in zones), 2) for vt in VEHICLE_TYPES
    }
    active_is_deep_learning = model.kind == "deep-learning"

    return {
        "model": model.name,
        "generated_at": iso_utc(demand.last_refresh()),
        "raining": raining,
        "horizon_minutes": horizon_minutes,
        "zones": [
            {
                "zone_id": z.id,
                "zone": z.name,
                "lat": z.center_lat,
                "lng": z.center_lng,
                **{vt: round(window_predictions[z.id][vt], 2) for vt in VEHICLE_TYPES},
                "total": round(sum(window_predictions[z.id].values()), 2),
                "free_riders": sum(supply[z.id].values()),
                "free_riders_by_type": supply[z.id],
            }
            for z in zones
        ],
        "hourly": hourly,
        "model_comparison": {
            "baseline": {
                "name": demand_baseline_forecaster.name,
                "kind": demand_baseline_forecaster.kind,
                "status": "active" if model.name == demand_baseline_forecaster.name else "comparison",
                "predictions_by_vehicle": {vt: round(baseline_predictions[vt], 2) for vt in VEHICLE_TYPES},
                "metrics": model_metrics(baseline_errors),
            },
            "deep_learning": {
                "name": model.name if active_is_deep_learning else None,
                "kind": "deep-learning",
                "status": "active" if active_is_deep_learning else "pending",
                "predictions_by_vehicle": active_by_vehicle if active_is_deep_learning else None,
                "metrics": model_metrics(model_errors) if active_is_deep_learning else None,
            },
        },
    }


@router.post("/forecasts/refresh")
def refresh_forecasts(db: DB, admin: Admin):
    n = demand.refresh_forecasts(db)
    return {"ok": True, "rows": n}


def _rule_values_out(r: PricingRule) -> dict:
    return {
        "base_fare": float(r.base_fare),
        "per_km": float(r.per_km),
        "per_min": float(r.per_min),
        "min_fare": float(r.min_fare),
        "max_multiplier": r.max_multiplier,
        "commission_pct": r.commission_pct if r.commission_pct is not None else settings.default_commission_pct,
    }


def _rule_out(r: PricingRule) -> dict:
    return {"id": r.id, "vehicle_type": r.vehicle_type, **_rule_values_out(r)}


@router.get("/pricing")
def pricing_rules(db: DB, admin: Admin):
    return [_rule_out(r) for r in db.scalars(select(PricingRule).order_by(PricingRule.id))]


@router.get("/pricing/rule-history")
def pricing_rule_history(
    db: DB,
    admin: Admin,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    rows = db.execute(
        select(PricingRuleChange, Profile.full_name, Profile.email)
        .join(Profile, Profile.id == PricingRuleChange.changed_by_id)
        .order_by(PricingRuleChange.changed_at.desc(), PricingRuleChange.id.desc())
        .offset(offset)
        .limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    items = [
        {
            "id": change.id,
            "vehicle_type": change.vehicle_type,
            "previous_values": json.loads(change.previous_values_json),
            "current_values": json.loads(change.current_values_json),
            "changed_by": full_name,
            "changed_by_email": email,
            "changed_at": iso_utc(change.changed_at),
        }
        for change, full_name, email in rows[:limit]
    ]
    return {"items": items, "has_more": has_more}


@router.get("/pricing/multiplier-history")
def pricing_multiplier_history(
    db: DB,
    admin: Admin,
    vehicle_type: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    if vehicle_type is not None and vehicle_type not in VEHICLE_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown vehicle type")
    query = select(Trip).order_by(Trip.requested_at.desc(), Trip.id.desc())
    if vehicle_type is not None:
        query = query.where(Trip.vehicle_type_requested == vehicle_type)
    trips = db.scalars(query.offset(offset).limit(limit + 1)).all()
    has_more = len(trips) > limit
    items = [
        {
            "trip_id": trip.id,
            "vehicle_type": trip.vehicle_type_requested,
            "multiplier": trip.price_multiplier,
            "price_reason": trip.price_reason,
            "fare_estimate": float(trip.fare_estimate),
            "fare_final": float(trip.fare_final) if trip.fare_final is not None else None,
            "status": trip.status,
            "requested_at": iso_utc(trip.requested_at),
        }
        for trip in trips[:limit]
    ]
    return {"items": items, "has_more": has_more}


@router.put("/pricing/{vehicle_type}")
def update_pricing(vehicle_type: str, body: PricingRuleIn, db: DB, admin: Admin):
    rule = db.scalar(select(PricingRule).where(PricingRule.vehicle_type == vehicle_type))
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown vehicle type")
    previous_values = _rule_values_out(rule)
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    current_values = _rule_values_out(rule)
    if previous_values != current_values:
        db.add(
            PricingRuleChange(
                vehicle_type=rule.vehicle_type,
                changed_by_id=admin.id,
                previous_values_json=json.dumps(previous_values, sort_keys=True),
                current_values_json=json.dumps(current_values, sort_keys=True),
            )
        )
        db.commit()
    return _rule_out(rule)
