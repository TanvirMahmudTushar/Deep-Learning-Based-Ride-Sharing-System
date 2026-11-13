"""Passenger dashboard: ride statistics, saved places, reviews, trip export and favourite or blocked riders."""

import csv
import io
from collections import Counter
from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import func, select

from app.db import local_month_start, local_time, utcnow
from app.models import VEHICLE_TYPES, Rating, Rider, RiderPreference, SavedPlace, Trip
from app.schemas import RiderPreferenceIn, SavedPlaceIn, SavedPlaceOut, iso_utc, rider_rating
from app.security import DB, Passenger
from app.services import cancel_fees, rider_prefs
from app.services.zones import describe_point

router = APIRouter(prefix="/api/passenger", tags=["passenger"])

WEEKS = 12
MAX_PLACES = 10


@router.get("/summary")
def summary(db: DB, user: Passenger):
    trips = db.scalars(select(Trip).where(Trip.user_id == user.id)).all()
    completed = [t for t in trips if t.status == "completed"]
    month_start = local_month_start()

    # Weekly spend for the last 12 weeks (weeks start on Saturday, the start of the Bangladeshi work week).
    today = local_time(utcnow()).date()
    this_week = today - timedelta(days=(today.weekday() - 5) % 7)
    weeks = [this_week - timedelta(weeks=i) for i in range(WEEKS - 1, -1, -1)]
    spend = {w: 0.0 for w in weeks}
    rides = {w: 0 for w in weeks}
    for t in completed:
        d = local_time(t.requested_at).date()
        w = d - timedelta(days=(d.weekday() - 5) % 7)
        if w in spend:
            spend[w] += float(t.fare_final or 0)
            rides[w] += 1

    by_vehicle = Counter(t.vehicle_type_requested for t in completed)
    favorite = by_vehicle.most_common(1)[0][0] if by_vehicle else None

    # Frequent destinations, with the coordinates of the latest trip there (for "ride again").
    dest_counts = Counter(t.drop_address for t in completed if t.drop_address)
    latest: dict[str, Trip] = {}
    for t in sorted(completed, key=lambda t: t.requested_at):
        latest[t.drop_address] = t
    top_destinations = [
        {
            "address": addr,
            "trips": n,
            "lat": latest[addr].drop_lat,
            "lng": latest[addr].drop_lng,
            "vehicle_type": latest[addr].vehicle_type_requested,
        }
        for addr, n in dest_counts.most_common(5)
    ]

    avg_given = db.scalar(select(func.avg(Rating.stars)).join(Trip, Trip.id == Rating.trip_id).where(Trip.user_id == user.id))
    spent_total = sum(float(t.fare_final or 0) for t in completed)
    return {
        "trips_total": len(trips),
        "trips_completed": len(completed),
        "trips_cancelled": sum(1 for t in trips if t.status == "cancelled"),
        "cancelled_by_you": sum(1 for t in trips if t.cancelled_by == "user"),
        "spent_total": round(spent_total),
        "spent_this_month": round(sum(float(t.fare_final or 0) for t in completed if t.requested_at >= month_start)),
        "rides_this_month": sum(1 for t in completed if t.requested_at >= month_start),
        "avg_fare": round(spent_total / len(completed)) if completed else None,
        "distance_km_total": round(sum(t.distance_km for t in completed), 1),
        "minutes_total": round(sum(t.actual_duration_min or t.predicted_eta_min for t in completed)),
        "avg_rating_given": round(float(avg_given), 2) if avg_given is not None else None,
        "favorite_vehicle": favorite,
        "by_vehicle": {vt: by_vehicle.get(vt, 0) for vt in VEHICLE_TYPES},
        "weekly": [{"week_start": w.isoformat(), "spent": round(spend[w]), "rides": rides[w]} for w in weeks],
        "top_destinations": top_destinations,
        "member_since": iso_utc(user.created_at),
        "outstanding_fee": cancel_fees.outstanding(db, user.id),
    }


@router.get("/reviews")
def reviews(db: DB, user: Passenger):
    """The passenger's ratings, newest first."""
    rows = db.execute(
        select(Rating, Trip).join(Trip, Trip.id == Rating.trip_id).where(Trip.user_id == user.id).order_by(Rating.created_at.desc()).limit(200)
    ).all()
    return [
        {
            "trip_id": trip.id,
            "stars": rating.stars,
            "comment": rating.comment or None,
            "rated_at": iso_utc(rating.created_at),
            "requested_at": iso_utc(trip.requested_at),
            "pickup_address": trip.pickup_address,
            "drop_address": trip.drop_address,
            "vehicle_type": trip.vehicle_type_requested,
            "rider_name": trip.rider.profile.full_name if trip.rider else None,
        }
        for rating, trip in rows
    ]


def _csv_cell(value) -> str:
    """Stop spreadsheet apps from running a cell as a formula."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


@router.get("/trips/export")
def export_trips(db: DB, user: Passenger):
    """All of the passenger's trips as a CSV file. Times are Dhaka time."""
    trips = db.scalars(select(Trip).where(Trip.user_id == user.id).order_by(Trip.requested_at.desc()).limit(5000)).all()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Date", "From", "To", "Vehicle", "Distance (km)", "Fare (BDT)", "Earlier fees or credits (BDT)", "Status", "Payment", "Your rating", "Cancellation reason", "Late-cancellation fee (BDT)"])
    for t in trips:
        writer.writerow(
            [
                _csv_cell(v)
                for v in (
                    local_time(t.requested_at).strftime("%Y-%m-%d %H:%M"),
                    t.pickup_address,
                    t.drop_address,
                    t.vehicle_type_requested,
                    round(t.distance_km, 1),
                    round(float(t.fare_final if t.fare_final is not None else t.fare_estimate)),
                    t.fee_adjustment or "",
                    t.status,
                    t.payment.status if t.payment else "",
                    t.rating.stars if t.rating else "",
                    t.cancel_reason or "",
                    f"{t.cancel_fee:g} ({t.cancel_fee_status})" if t.cancel_fee else "",
                )
            ]
        )
    return Response(
        content="\ufeff" + out.getvalue(),  # BOM, so Excel reads Bangla addresses correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="cholo-trips.csv"', "Cache-Control": "no-store"},
    )


def _place_out(p: SavedPlace) -> SavedPlaceOut:
    return SavedPlaceOut(id=p.id, label=p.label, lat=p.lat, lng=p.lng, address=p.address)


@router.get("/places", response_model=list[SavedPlaceOut])
def list_places(db: DB, user: Passenger):
    places = db.scalars(select(SavedPlace).where(SavedPlace.user_id == user.id).order_by(SavedPlace.created_at))
    return [_place_out(p) for p in places]


@router.post("/places", response_model=SavedPlaceOut, status_code=status.HTTP_201_CREATED)
def add_place(body: SavedPlaceIn, db: DB, user: Passenger):
    count = db.scalar(select(func.count(SavedPlace.id)).where(SavedPlace.user_id == user.id)) or 0
    if count >= MAX_PLACES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can save up to {MAX_PLACES} places")
    label = body.label.strip()
    if db.scalar(select(SavedPlace.id).where(SavedPlace.user_id == user.id, func.lower(SavedPlace.label) == label.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, f'You already have a place called "{label}"')
    place = SavedPlace(
        user_id=user.id,
        label=label,
        lat=body.lat,
        lng=body.lng,
        address=(body.address or "").strip() or describe_point(db, (body.lat, body.lng)),
    )
    db.add(place)
    db.commit()
    return _place_out(place)


@router.delete("/places/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place(place_id: str, db: DB, user: Passenger):
    place = db.get(SavedPlace, place_id)
    if place is None or place.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Place not found")
    db.delete(place)
    db.commit()


# --- favourite and blocked riders (#47) ---------------------------------------------------


def _pref_out(db: DB, user_id: str, pref: RiderPreference) -> dict:
    rider = db.get(Rider, pref.rider_id)
    trips, last = db.execute(
        select(func.count(Trip.id), func.max(Trip.requested_at)).where(
            Trip.user_id == user_id, Trip.rider_id == pref.rider_id, Trip.status == "completed"
        )
    ).one()
    vehicle = rider.vehicle if rider else None
    rating, _ = rider_rating(db, pref.rider_id)
    return {
        "rider_id": pref.rider_id,
        # First name only: the passenger's list never shows phone numbers or full names.
        "name": rider.profile.full_name.split(" ")[0] if rider else "Rider",
        "vehicle_type": vehicle.vehicle_type if vehicle else None,
        "vehicle_model": vehicle.model if vehicle else None,
        "rating": rating,
        "trips_together": int(trips or 0),
        "last_trip_at": iso_utc(last) if last else None,
        "kind": pref.kind,
        "reason": pref.reason or None,
        "since": iso_utc(pref.created_at),
    }


@router.get("/riders")
def list_riders(db: DB, user: Passenger):
    """The passenger's favourite and blocked riders, newest first."""
    prefs = db.scalars(
        select(RiderPreference).where(RiderPreference.user_id == user.id).order_by(RiderPreference.created_at.desc())
    ).all()
    out = [_pref_out(db, user.id, p) for p in prefs]
    return {"favourites": [p for p in out if p["kind"] == "favourite"], "blocked": [p for p in out if p["kind"] == "blocked"]}


@router.put("/riders/{rider_id}")
def set_rider_preference(rider_id: str, body: RiderPreferenceIn, db: DB, user: Passenger):
    """Favourite or block a rider you have ridden with. Blocking a favourite replaces the favourite."""
    if db.get(Rider, rider_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider not found")
    if not rider_prefs.rode_with(db, user.id, rider_id, completed_only=body.kind == "favourite"):
        detail = (
            "You can favourite a rider after finishing a trip with them"
            if body.kind == "favourite"
            else "You can only block riders who have taken one of your trips"
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail)
    pref = rider_prefs.get(db, user.id, rider_id)
    limit = rider_prefs.LIMITS[body.kind]
    if (pref is None or pref.kind != body.kind) and rider_prefs.count(db, user.id, body.kind) >= limit:
        noun = "favourite riders" if body.kind == "favourite" else "blocked riders"
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can have up to {limit} {noun}")
    reason = body.reason.strip() if body.kind == "blocked" else ""
    if pref is None:
        pref = RiderPreference(user_id=user.id, rider_id=rider_id, kind=body.kind, reason=reason, created_at=utcnow())
        db.add(pref)
    elif pref.kind != body.kind:
        pref.kind, pref.reason, pref.created_at = body.kind, reason, utcnow()
    else:
        pref.reason = reason
    db.commit()
    return _pref_out(db, user.id, pref)


@router.delete("/riders/{rider_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_rider_preference(rider_id: str, db: DB, user: Passenger):
    """Remove a favourite or unblock a rider."""
    pref = rider_prefs.get(db, user.id, rider_id)
    if pref is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This rider is not in your list")
    db.delete(pref)
    db.commit()
