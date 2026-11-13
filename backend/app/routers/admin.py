"""Admin dashboard endpoints: platform stats, rider verification, live trips, alerts, forecasts, pricing.

Live trips, recent trips and safety alerts also serve approved support agents (`Staff`); everything else is admin-only.
"""

import json
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import aliased, selectinload

from app.config import settings
from app.db import DHAKA_TZ, local_day_start, local_time, utcnow
from app.geo import haversine_km
from app.models import (
    ACTIVE_TRIP_STATUSES,
    VEHICLE_TYPES,
    AlertNote,
    DemandForecast,
    PricingRule,
    PricingRuleChange,
    Profile,
    Rider,
    SafetyAlert,
    Trip,
    TripLocation,
    Vehicle,
)
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
    AlertNoteIn,
)
from app.security import DB, Admin, Staff, account_is_suspended
from app.realtime import ADMINS, emit, hub
from app.services import availability, cancel_fees, demand, documents, rider_prefs, simulator
from app.services import trips as trip_service
from app.services.alert_severity import anomaly_severity
from app.services.alerts import ensure_summary
from app.services.predictors import active_demand_model, demand_baseline_forecaster, eta_predictor, predict_demand, registry
from app.services.weather import current_weather, is_raining
from app.services.zones import all_zones
from app.routers.vehicle_changes import pending_change_rider_ids


router = APIRouter(prefix="/api/admin", tags=["admin"])


class SimulatorControlsIn(BaseModel):
    speedup: float = Field(ge=1, le=10)
    anomaly_rate: float = Field(ge=0, le=0.5)


@router.get("/stats")
def stats(db: DB, admin: Admin):
    today = local_day_start()
    week = utcnow() - timedelta(days=7)
    today_local = local_time(utcnow()).date()
    first_day = today_local - timedelta(days=6)

    def count(*where) -> int:
        return db.scalar(select(func.count(Trip.id)).where(*where)) or 0

    trips_week = count(Trip.requested_at >= week)
    cancelled_week = count(Trip.requested_at >= week, Trip.status == "cancelled")
    rider_cancels_week = count(Trip.requested_at >= week, Trip.cancelled_by == "rider")
    passenger_cancels_week = count(Trip.requested_at >= week, Trip.cancelled_by == "user")

    completed = db.execute(
        select(Trip.predicted_eta_min, Trip.actual_duration_min).where(
            Trip.completed_at >= week, Trip.status == "completed", Trip.actual_duration_min.is_not(None)
        )
    ).all()
    eta_errors = [abs(predicted - actual) for predicted, actual in completed if predicted is not None]
    wait_rows = db.execute(
        select(Trip.requested_at, Trip.arrived_at).where(Trip.requested_at >= week, Trip.arrived_at.is_not(None))
    ).all()
    waits = [
        (arrived_at - requested_at).total_seconds() / 60
        for requested_at, arrived_at in wait_rows
        if arrived_at >= requested_at
    ]

    daily = {
        (first_day + timedelta(days=offset)).isoformat(): {"trips": 0, "completed": 0, "cancelled": 0}
        for offset in range(7)
    }
    daily_start = datetime.combine(first_day, time.min, tzinfo=DHAKA_TZ).astimezone(UTC).replace(tzinfo=None)
    daily_rows = db.execute(
        select(Trip.requested_at, Trip.status).where(Trip.requested_at >= daily_start)
    ).all()
    for requested_at, trip_status in daily_rows:
        day = local_time(requested_at).date().isoformat()
        if day not in daily:
            continue
        daily[day]["trips"] += 1
        if trip_status == "completed":
            daily[day]["completed"] += 1
        elif trip_status == "cancelled":
            daily[day]["cancelled"] += 1

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
        "passenger_cancel_rate_7d": round(passenger_cancels_week / trips_week, 3) if trips_week else 0.0,
        "avg_pickup_wait_min_7d": round(sum(waits) / len(waits), 1) if waits else None,
        "eta_mae_min_7d": round(sum(eta_errors) / len(eta_errors), 2) if eta_errors else None,
        "eta_rmse_min_7d": round((sum(error * error for error in eta_errors) / len(eta_errors)) ** 0.5, 2)
        if eta_errors
        else None,
        "daily_trips": [
            {
                "date": day,
                **values,
                "completion_rate": round(values["completed"] / values["trips"], 3) if values["trips"] else 0.0,
            }
            for day, values in daily.items()
        ],
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
        "pending_support": db.scalar(select(func.count(Profile.id)).where(Profile.role == "support", Profile.approval_status == "pending")) or 0,
        "open_alerts": db.scalar(select(func.count(SafetyAlert.id)).where(SafetyAlert.status == "open")) or 0,
        "weather": {"temperature_c": weather.temperature_c, "precipitation_mm": weather.precipitation_mm, "raining": is_raining(db)}
        if weather
        else None,
    }


@router.get("/model-evaluation")
def model_evaluation(db: DB, admin: Admin):
    now = utcnow()
    since = now - timedelta(days=30)
    trips = db.execute(
        select(
            Trip.vehicle_type_requested,
            Trip.distance_km,
            Trip.requested_at,
            Trip.predicted_eta_min,
            Trip.actual_duration_min,
        ).where(
            Trip.completed_at >= since,
            Trip.status == "completed",
            Trip.actual_duration_min.is_not(None),
            Trip.predicted_eta_min.is_not(None),
        )
    ).all()

    baseline_errors: list[float] = []
    recorded_errors: list[float] = []
    for vehicle_type, distance_km, requested_at, predicted_eta, actual_duration in trips:
        baseline_eta = eta_predictor.predict_eta(distance_km, vehicle_type, requested_at)
        baseline_errors.append(abs(baseline_eta - actual_duration))
        recorded_errors.append(abs(predicted_eta - actual_duration))

    def metrics(errors: list[float]) -> dict[str, float | int | None]:
        if not errors:
            return {"mae_min": None, "rmse_min": None, "samples": 0}
        return {
            "mae_min": round(sum(errors) / len(errors), 2),
            "rmse_min": round((sum(error * error for error in errors) / len(errors)) ** 0.5, 2),
            "samples": len(errors),
        }

    eta_model = registry["eta"]
    return {
        "generated_at": iso_utc(now),
        "window_days": 30,
        "eta": {
            "baseline_name": eta_predictor.name,
            "recorded_model_name": eta_model.name,
            "recorded_model_kind": eta_model.kind,
            "baseline": metrics(baseline_errors),
            "recorded": metrics(recorded_errors),
        },
        "baseline_only_models": [
            {"component": component, "name": model.name, "kind": model.kind}
            for component, model in registry.items()
            if component != "eta"
        ],
    }


def _simulator_status(db: DB) -> dict:
    simulated_rider_ids = select(Rider.id).where(Rider.is_simulated.is_(True))
    active_simulated_trips = db.scalar(
        select(func.count(Trip.id)).where(
            Trip.status.in_(ACTIVE_TRIP_STATUSES),
            or_(
                Trip.auto_drive.is_(True),
                Trip.rider_id.in_(simulated_rider_ids),
                Trip.offered_rider_id.in_(simulated_rider_ids),
            ),
        )
    ) or 0
    return {
        "running": settings.simulator_enabled,
        "speedup": settings.simulator_speedup,
        "anomaly_rate": settings.simulator_anomaly_rate,
        "active_simulated_trips": active_simulated_trips,
    }


@router.get("/simulator")
def simulator_status(db: DB, admin: Admin):
    return _simulator_status(db)


@router.put("/simulator")
def update_simulator(controls: SimulatorControlsIn, db: DB, admin: Admin):
    simulator.update_controls(controls.speedup, controls.anomaly_rate)
    return _simulator_status(db)


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
    changing = pending_change_rider_ids(db)
    blocked_by = rider_prefs.blocked_counts(db)
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
                "vehicle_change_pending": r.id in changing,
                # How many passengers have blocked this rider (helps spot problem riders).
                "blocked_by": blocked_by.get(r.id, 0),
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
    if rider.vehicle:
        rider.vehicle.verified = True
    emit(db, rider.profile_id, "profile.updated", notify=("You're verified", "You can go online and start accepting trips."))
    emit(db, ADMINS, "riders.changed")
    db.commit()
    return {"ok": True, "status": rider.status}


@router.post("/riders/{rider_id}/suspend")
def suspend_rider(rider_id: str, db: DB, admin: Admin):
    rider = _rider_or_404(db, rider_id)
    return _set_account_status(db, rider.profile, suspended=True)


def _agent_out(p: Profile) -> dict:
    return {
        "id": p.id,
        "full_name": p.full_name,
        "email": p.email,
        "phone": p.phone,
        "status": p.approval_status,
        "joined_at": iso_utc(p.created_at),
    }


@router.get("/support-agents")
def support_agents(db: DB, admin: Admin):
    agents = db.scalars(select(Profile).where(Profile.role == "support").order_by(Profile.created_at.desc())).all()
    return [_agent_out(p) for p in sorted(agents, key=lambda p: p.approval_status != "pending")]


def _set_agent_status(db: DB, agent_id: str, new_status: str) -> dict:
    agent = db.get(Profile, agent_id)
    if agent is None or agent.role != "support":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Support agent not found")
    agent.approval_status = new_status
    emit(db, ADMINS, "support.changed")
    db.commit()
    if new_status == "revoked":
        hub.close_profile(agent.id)  # stop live events straight away, not at the next page refresh
    return _agent_out(agent)


@router.post("/support-agents/{agent_id}/approve")
def approve_support_agent(agent_id: str, db: DB, admin: Admin):
    return _set_agent_status(db, agent_id, "approved")


@router.post("/support-agents/{agent_id}/revoke")
def revoke_support_agent(agent_id: str, db: DB, admin: Admin):
    return _set_agent_status(db, agent_id, "revoked")


@router.get("/trips/live")
def live_trips(db: DB, staff: Staff):
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


def _local_day_start_utc(d: date) -> datetime:
    """Midnight in Dhaka on that date, as the naive UTC time the database stores."""
    return datetime.combine(d, time.min, tzinfo=DHAKA_TZ).astimezone(UTC).replace(tzinfo=None)


@router.get("/trips/recent")
def recent_trips(
    db: DB,
    staff: Staff,
    q: str | None = None,
    status_filter: Literal["requested", "accepted", "ongoing", "completed", "cancelled"] | None = None,
    vehicle_type: Literal["bike", "cng", "car"] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    offset: int = 0,
    limit: int = 50,
):
    """Trips newest first. `q` matches the passenger's name, the rider's name or the plate number;
    dates are Dhaka calendar days, both inclusive."""
    limit, offset = max(1, min(limit, 200)), max(0, offset)
    stmt = select(Trip)
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        passenger, rider_profile = aliased(Profile), aliased(Profile)
        stmt = (
            stmt.join(passenger, passenger.id == Trip.user_id)
            .outerjoin(Rider, Rider.id == Trip.rider_id)
            .outerjoin(rider_profile, rider_profile.id == Rider.profile_id)
            .outerjoin(Vehicle, Vehicle.id == Trip.vehicle_id)
            .where(
                or_(
                    func.lower(passenger.full_name).like(term),
                    func.lower(rider_profile.full_name).like(term),
                    func.lower(Vehicle.plate_no).like(term),
                )
            )
        )
    if status_filter:
        stmt = stmt.where(Trip.status == status_filter)
    if vehicle_type:
        stmt = stmt.where(Trip.vehicle_type_requested == vehicle_type)
    if date_from:
        stmt = stmt.where(Trip.requested_at >= _local_day_start_utc(date_from))
    if date_to:
        stmt = stmt.where(Trip.requested_at < _local_day_start_utc(date_to + timedelta(days=1)))
    rows = db.scalars(stmt.order_by(Trip.requested_at.desc()).offset(offset).limit(limit + 1)).all()
    return {
        "trips": [trip_out(db, t, include_route=False).model_dump(mode="json") for t in rows[:limit]],
        "has_more": len(rows) > limit,
    }


# What a passenger sees for their own report.
REPORT_STATUS_LABEL = {"open": "Received", "reviewed": "Being reviewed", "closed": "Closed"}
ALERT_TYPES = ("sos", "report", "route_deviation", "long_stop")


def _note_out(n: AlertNote) -> dict:
    return {
        "id": n.id,
        "body": n.body,
        "for_passenger": n.for_passenger,
        "author_name": n.author.full_name,
        "author_role": n.author.role,
        "created_at": iso_utc(n.created_at),
    }


def _person(db: DB, profile_id: str | None) -> dict | None:
    p = db.get(Profile, profile_id) if profile_id else None
    return {"id": p.id, "name": p.full_name} if p else None


def _alert_out(db: DB, a: SafetyAlert) -> dict:
    rider_profile = a.trip.rider.profile if a.trip.rider else None
    last_changed = _person(db, a.reviewed_by)
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
        "rider_name": rider_profile.full_name if rider_profile else None,
        "rider_phone": rider_profile.phone if rider_profile else None,
        # The passenger's phone number stays hidden from staff (see issue #23).
        "passenger_name": a.trip.user.full_name,
        "assigned_to": _person(db, a.assigned_to),
        "last_changed_by": last_changed["name"] if last_changed else None,
        "notes": [_note_out(n) for n in a.notes],
    }


@router.get("/alerts")
def alerts(db: DB, staff: Staff, status_filter: str | None = None):
    # Open SOS alerts first, then newest first.
    sos_first = case((and_(SafetyAlert.alert_type == "sos", SafetyAlert.status == "open"), 0), else_=1)
    q = select(SafetyAlert).order_by(sos_first, SafetyAlert.created_at.desc()).limit(100)
    if status_filter:
        q = q.where(SafetyAlert.status == ("closed" if status_filter == "resolved" else status_filter))
    return [_alert_out(db, a) for a in db.scalars(q)]


@router.get("/alerts/summary")
def alerts_summary(db: DB, staff: Staff):
    """How much work is waiting. Counts only, with no revenue or other admin figures."""
    rows = db.execute(
        select(SafetyAlert.alert_type, func.count(SafetyAlert.id), func.min(SafetyAlert.created_at))
        .where(SafetyAlert.status == "open")
        .group_by(SafetyAlert.alert_type)
    ).all()
    by_type = {t: 0 for t in ALERT_TYPES}
    oldest = None
    for alert_type, n, first in rows:
        by_type[alert_type] = by_type.get(alert_type, 0) + n
        oldest = first if oldest is None or first < oldest else oldest
    unassigned = db.scalar(
        select(func.count(SafetyAlert.id)).where(SafetyAlert.status == "open", SafetyAlert.assigned_to.is_(None))
    )
    return {
        "open_total": sum(by_type.values()),
        "by_type": by_type,
        "unassigned": unassigned or 0,
        "oldest_open_at": iso_utc(oldest),
        "oldest_open_minutes": round((utcnow() - oldest).total_seconds() / 60) if oldest else None,
    }


def _alert_or_404(db: DB, alert_id: str) -> SafetyAlert:
    alert = db.get(SafetyAlert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    return alert


@router.post("/alerts/{alert_id}/summarize")
def summarize(alert_id: str, db: DB, staff: Staff):
    alert = _alert_or_404(db, alert_id)
    ensure_summary(db, alert)
    return _alert_out(db, alert)


def _alert_changed(db: DB, alert: SafetyAlert, passenger_notice: tuple[str, str] | None = None) -> None:
    emit(db, ADMINS, "alert.updated", alert_id=alert.id)
    if passenger_notice and alert.alert_type == "report":
        emit(db, alert.trip.user_id, "report.updated", notify=passenger_notice, trip_id=alert.trip_id)


@router.post("/alerts/{alert_id}/status")
def set_alert_status(alert_id: str, body: AlertStatusIn, db: DB, staff: Staff):
    if body.status == "closed" and not (body.resolution_note or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A resolution note is required")
    alert = _alert_or_404(db, alert_id)
    changed = alert.status != body.status
    alert.status = body.status
    alert.reviewed_by = staff.id
    if body.resolution_note is not None:
        alert.resolution_note = body.resolution_note.strip() or None
    notice = ("Update on your report", f"Your report is now: {REPORT_STATUS_LABEL[body.status].lower()}.") if changed else None
    _alert_changed(db, alert, notice)
    db.commit()
    return _alert_out(db, alert)


@router.post("/alerts/{alert_id}/claim")
def claim_alert(alert_id: str, db: DB, staff: Staff):
    """Take ownership of an alert. Admins may take over one that someone else is handling."""
    alert = _alert_or_404(db, alert_id)
    if alert.assigned_to and alert.assigned_to != staff.id and staff.role != "admin":
        owner = _person(db, alert.assigned_to)
        raise HTTPException(status.HTTP_409_CONFLICT, f"{owner['name'] if owner else 'Someone else'} is already handling this alert")
    alert.assigned_to = staff.id
    _alert_changed(db, alert)
    db.commit()
    return _alert_out(db, alert)


@router.post("/alerts/{alert_id}/release")
def release_alert(alert_id: str, db: DB, staff: Staff):
    alert = _alert_or_404(db, alert_id)
    if alert.assigned_to not in (None, staff.id) and staff.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person handling this alert, or an admin, can release it")
    alert.assigned_to = None
    _alert_changed(db, alert)
    db.commit()
    return _alert_out(db, alert)


@router.post("/alerts/{alert_id}/notes", status_code=status.HTTP_201_CREATED)
def add_alert_note(alert_id: str, body: AlertNoteIn, db: DB, staff: Staff):
    alert = _alert_or_404(db, alert_id)
    if body.for_passenger and alert.alert_type != "report":
        raise HTTPException(status.HTTP_409_CONFLICT, "Replies can only be sent on passenger reports")
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "Write something first")
    note = AlertNote(alert_id=alert.id, author_id=staff.id, body=text, for_passenger=body.for_passenger)
    db.add(note)
    alert.notes.append(note)
    db.flush()
    notice = ("Reply to your report", text if len(text) <= 140 else text[:137] + "...") if body.for_passenger else None
    _alert_changed(db, alert, notice)
    db.commit()
    return _alert_out(db, alert)


@router.get("/trips/{trip_id}")
def trip_detail(trip_id: str, db: DB, staff: Staff):
    """One trip for the support desk: route, timeline, fare, payment status, rating and its alerts.
    Commission and rider earnings are left out, and so is the passenger's phone number."""
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    alerts_on_trip = db.scalars(select(SafetyAlert).where(SafetyAlert.trip_id == trip.id).order_by(SafetyAlert.created_at)).all()
    return {"trip": trip_out(db, trip).model_dump(mode="json"), "alerts": [_alert_out(db, a) for a in alerts_on_trip]}


@router.get("/cancel-fees")
def cancellation_fees(db: DB, admin: Admin):
    """Recent late-cancellation fees, so an admin can waive one (the passenger's refund)."""
    trips = db.scalars(select(Trip).where(Trip.cancel_fee.is_not(None)).order_by(Trip.completed_at.desc()).limit(100))
    return [
        {
            "trip_id": t.id,
            "passenger_name": t.user.full_name,
            "rider_name": t.rider.profile.full_name if t.rider else None,
            "vehicle_type": t.vehicle_type_requested,
            "pickup_address": t.pickup_address,
            "cancelled_at": iso_utc(t.completed_at),
            "cancel_reason": t.cancel_reason,
            "fee": t.cancel_fee,
            "status": t.cancel_fee_status,
        }
        for t in trips
    ]


@router.post("/trips/{trip_id}/cancel-fee/waive")
def waive_cancel_fee(trip_id: str, db: DB, admin: Admin):
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    try:
        new_status = cancel_fees.waive(db, trip)
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    db.commit()
    return {"trip_id": trip.id, "status": new_status}


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
        "cancel_fee": r.cancel_fee if r.cancel_fee is not None else cancel_fees.DEFAULT_CANCEL_FEE.get(r.vehicle_type, 0.0),
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
    for k, v in body.model_dump(exclude_unset=True).items():
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
