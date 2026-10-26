"""Rider portal endpoints: availability, offers and the trip lifecycle from the driver's side."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.config import settings
from app.db import local_day_start, utcnow
from app.geo import haversine_km
from app.models import Payment, Rider, Trip
from app.schemas import AutoDriveIn, LocationIn, OfferOut, OnlineIn, RiderMe, TripOut, rider_rating, trip_out, vehicle_out
from app.security import DB, CurrentRider
from app.realtime import ADMINS, emit
from app.services import documents, payments
from app.services import trips as trip_service
from app.services.matching import rider_cancel_rates

router = APIRouter(prefix="/api/rider", tags=["rider"])


def _assigned_trip(db: DB, rider: Rider, trip_id: str) -> Trip:
    trip = db.get(Trip, trip_id)
    if trip is None or trip.rider_id != rider.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    return trip


def _offered_trip(db: DB, rider: Rider, trip_id: str) -> Trip:
    trip = db.get(Trip, trip_id)
    if trip is None or trip.offered_rider_id != rider.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found or expired")
    return trip


@router.get("/me", response_model=RiderMe)
def me(db: DB, rider: CurrentRider):
    rating, count = rider_rating(db, rider.id)
    completed = db.scalar(select(func.count()).where(Trip.rider_id == rider.id, Trip.status == "completed")) or 0
    earnings = db.scalar(
        select(func.sum(Payment.rider_earning)).where(
            Payment.rider_id == rider.id, Payment.status != "disputed", Payment.created_at >= local_day_start()
        )
    )
    ready, missing = documents.verification_ready(db, rider)
    return RiderMe(
        id=rider.id,
        full_name=rider.profile.full_name,
        email=rider.profile.email,
        phone=rider.profile.phone,
        license_no=rider.license_no,
        status=rider.status,
        is_online=rider.is_online,
        lat=rider.current_lat,
        lng=rider.current_lng,
        vehicle=vehicle_out(rider.vehicle),
        rating=rating,
        rating_count=count,
        trips_completed=completed,
        earnings_today=float(earnings or 0),
        cancel_rate=round(rider_cancel_rates(db, [rider.id]).get(rider.id, 0.05), 3),
        is_simulated=rider.is_simulated,
        documents_ready=ready,
        missing_documents=missing,
        commission_due=payments.rider_balance(db, rider.id)["commission_due"],
    )


@router.post("/online", response_model=RiderMe)
def set_online(body: OnlineIn, db: DB, rider: CurrentRider):
    if body.is_online:
        if rider.status == "suspended":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is suspended. Contact support.")
        if rider.status != "verified":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is waiting for admin verification")
        if body.lat is not None and body.lng is not None:
            rider.current_lat, rider.current_lng = body.lat, body.lng
        if rider.current_lat is None:
            raise HTTPException(422, "Allow location access (or set your position on the map) before going online")
    elif trip_service.active_trip_for_rider(db, rider.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Finish your current trip before going offline")
    else:
        pending = db.scalar(select(Trip).where(Trip.status == "requested", Trip.offered_rider_id == rider.id))
        if pending:
            trip_service.decline(db, pending, rider)
    rider.is_online = body.is_online
    rider.last_seen = utcnow()
    emit(db, ADMINS, "live.changed", coalesce="admin-live")
    db.commit()
    return me(db, rider)


@router.post("/location", response_model=RiderMe)
def update_location(body: LocationIn, db: DB, rider: CurrentRider):
    """A GPS fix from the rider's device, sent every few seconds while the portal is open."""
    trip = trip_service.active_trip_for_rider(db, rider.id)
    if trip and trip.auto_drive:
        raise HTTPException(status.HTTP_409_CONFLICT, "Turn off auto-drive to send your own location")
    trip_service.record_location(db, trip, rider, (body.lat, body.lng), body.speed_kmh, body.accuracy_m)
    db.commit()
    return me(db, rider)


@router.get("/offer", response_model=OfferOut | None)
def current_offer(db: DB, rider: CurrentRider):
    trip_service.expire_stale_offers(db)
    db.commit()
    trip = db.scalar(select(Trip).where(Trip.status == "requested", Trip.offered_rider_id == rider.id))
    if trip is None:
        return None
    return OfferOut(
        trip=trip_out(db, trip, for_rider=True),
        expires_at=trip.offered_at + timedelta(seconds=settings.offer_timeout_seconds),
        pickup_distance_km=round(haversine_km((rider.current_lat, rider.current_lng), (trip.pickup_lat, trip.pickup_lng)), 2),
    )


@router.post("/offers/{trip_id}/accept", response_model=TripOut)
def accept(trip_id: str, db: DB, rider: CurrentRider):
    trip = trip_service.accept(db, _offered_trip(db, rider, trip_id), rider)
    db.commit()
    return trip_out(db, trip, for_rider=True)


@router.post("/offers/{trip_id}/decline")
def decline(trip_id: str, db: DB, rider: CurrentRider):
    trip_service.decline(db, _offered_trip(db, rider, trip_id), rider)
    db.commit()
    return {"ok": True}


@router.get("/active", response_model=TripOut | None)
def active(db: DB, rider: CurrentRider):
    trip = trip_service.active_trip_for_rider(db, rider.id)
    return trip_out(db, trip, for_rider=True) if trip else None


@router.post("/trips/{trip_id}/start", response_model=TripOut)
def start(trip_id: str, db: DB, rider: CurrentRider):
    trip = trip_service.start(db, _assigned_trip(db, rider, trip_id))
    db.commit()
    return trip_out(db, trip, for_rider=True)


@router.post("/trips/{trip_id}/complete", response_model=TripOut)
def complete(trip_id: str, db: DB, rider: CurrentRider):
    trip = trip_service.complete(db, _assigned_trip(db, rider, trip_id))
    db.commit()
    return trip_out(db, trip, for_rider=True)


@router.post("/trips/{trip_id}/cancel", response_model=TripOut)
def cancel(trip_id: str, db: DB, rider: CurrentRider):
    trip = trip_service.cancel(db, _assigned_trip(db, rider, trip_id), "rider", "Cancelled by rider")
    db.commit()
    return trip_out(db, trip, for_rider=True)


@router.post("/trips/{trip_id}/auto-drive", response_model=TripOut)
def auto_drive(trip_id: str, body: AutoDriveIn, db: DB, rider: CurrentRider):
    trip = _assigned_trip(db, rider, trip_id)
    if trip.status not in ("accepted", "ongoing"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Auto-drive only works on an active trip")
    if not settings.simulator_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "The trip simulator is disabled on this server")
    trip.auto_drive = body.enabled
    db.commit()
    return trip_out(db, trip, for_rider=True)


@router.get("/trips", response_model=list[TripOut])
def history(db: DB, rider: CurrentRider, limit: int = 20):
    trips = db.scalars(select(Trip).where(Trip.rider_id == rider.id).order_by(Trip.requested_at.desc()).limit(min(limit, 100)))
    return [trip_out(db, t, include_route=False, for_rider=True) for t in trips]
