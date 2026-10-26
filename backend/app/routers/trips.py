"""Passenger endpoints: estimate, book, track, cancel, rate, emergency alerts and problem reports."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.models import VEHICLE_TYPES, Rating, Trip
from app.schemas import EstimateIn, EstimateOut, QuoteOut, RateIn, ReportIn, SosIn, TripCreate, TripOut, trip_out
from app.security import DB, Passenger
from app.services import alerts, pricing
from app.services import trips as trip_service
from app.services.routing import get_route
from app.services.zones import describe_point

router = APIRouter(prefix="/api/trips", tags=["passenger"])


def _own_trip(db: DB, user: Passenger, trip_id: str) -> Trip:
    trip = db.get(Trip, trip_id)
    if trip is None or trip.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    return trip


@router.post("/estimate", response_model=EstimateOut)
def estimate(body: EstimateIn, db: DB, user: Passenger):
    pickup, drop = (body.pickup.lat, body.pickup.lng), (body.drop.lat, body.drop.lng)
    route = get_route(pickup, drop)
    quotes = [QuoteOut(**pricing.quote(db, pickup, route, vt).__dict__) for vt in VEHICLE_TYPES]
    return EstimateOut(
        pickup_address=describe_point(db, pickup),
        drop_address=describe_point(db, drop),
        distance_km=round(route.distance_km, 2),
        route=[list(p) for p in route.points],
        route_source=route.source,
        quotes=quotes,
    )


@router.post("", response_model=TripOut, status_code=status.HTTP_201_CREATED)
def create(body: TripCreate, db: DB, user: Passenger):
    trip = trip_service.create_trip(
        db,
        user,
        (body.pickup.lat, body.pickup.lng),
        (body.drop.lat, body.drop.lng),
        body.vehicle_type,
        body.pickup_address,
        body.drop_address,
    )
    db.commit()
    return trip_out(db, trip)


@router.get("/active", response_model=TripOut | None)
def active(db: DB, user: Passenger):
    trip_service.expire_stale_offers(db)
    db.commit()
    trip = trip_service.active_trip_for_user(db, user.id)
    return trip_out(db, trip) if trip else None


@router.get("", response_model=list[TripOut])
def history(db: DB, user: Passenger, limit: int = 20, offset: int = 0, status_filter: str | None = None):
    q = select(Trip).where(Trip.user_id == user.id)
    if status_filter:
        q = q.where(Trip.status == status_filter)
    trips = db.scalars(q.order_by(Trip.requested_at.desc()).offset(max(offset, 0)).limit(min(limit, 100)))
    return [trip_out(db, t, include_route=False) for t in trips]


@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: str, db: DB, user: Passenger):
    return trip_out(db, _own_trip(db, user, trip_id))


@router.post("/{trip_id}/cancel", response_model=TripOut)
def cancel(trip_id: str, db: DB, user: Passenger):
    trip = trip_service.cancel(db, _own_trip(db, user, trip_id), "user", "Cancelled by passenger")
    db.commit()
    return trip_out(db, trip)


@router.post("/{trip_id}/sos", response_model=TripOut)
def sos(trip_id: str, body: SosIn, db: DB, user: Passenger):
    trip = _own_trip(db, user, trip_id)
    if trip.status not in ("accepted", "ongoing"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Emergency alerts are for trips in progress")
    alerts.raise_sos(db, trip, body.note)
    db.commit()
    return trip_out(db, trip)


@router.post("/{trip_id}/report", status_code=status.HTTP_201_CREATED)
def report(trip_id: str, body: ReportIn, db: DB, user: Passenger):
    trip = _own_trip(db, user, trip_id)
    if trip.status not in ("completed", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Report a problem after the trip ends; use the emergency button during a trip")
    alerts.file_report(db, trip, body.category, body.note)
    if body.category == "fare" and trip.payment and trip.payment.status != "collected":
        trip.payment.status = "disputed"
    db.commit()
    return {"ok": True}


@router.post("/{trip_id}/rate", response_model=TripOut)
def rate(trip_id: str, body: RateIn, db: DB, user: Passenger):
    trip = _own_trip(db, user, trip_id)
    if trip.status != "completed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only completed trips can be rated")
    if trip.rating is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This trip is already rated")
    db.add(Rating(trip_id=trip.id, stars=body.stars, comment=body.comment.strip()))
    db.commit()
    db.refresh(trip)
    return trip_out(db, trip)
