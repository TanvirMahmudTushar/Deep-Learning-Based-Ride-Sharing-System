"""Admin dashboard endpoints: platform stats, rider verification, live trips, alerts, forecasts, pricing.

Live trips, recent trips and safety alerts also serve approved support agents (`Staff`); everything else is admin-only.
"""

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, status
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
    Profile,
    Rider,
    SafetyAlert,
    Trip,
    Vehicle,
)
from app.schemas import AlertNoteIn, AlertStatusIn, PricingRuleIn, iso_utc, rider_rating, trip_out, vehicle_out
from app.security import DB, Admin, Staff
from app.realtime import ADMINS, emit, hub
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
        "pending_support": db.scalar(select(func.count(Profile.id)).where(Profile.role == "support", Profile.approval_status == "pending")) or 0,
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
        "details": a.details,
        "summary": a.summary,
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
        q = q.where(SafetyAlert.status == status_filter)
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
    alert = _alert_or_404(db, alert_id)
    changed = alert.status != body.status
    alert.status = body.status
    alert.reviewed_by = staff.id
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
