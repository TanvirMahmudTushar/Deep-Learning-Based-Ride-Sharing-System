from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, PlainSerializer
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Rating, Rider, SafetyAlert, Trip, Vehicle

def iso_utc(d: datetime | None) -> str | None:
    """Stored datetimes are naive UTC; send them with an explicit offset so browsers parse them correctly."""
    return d.replace(tzinfo=UTC).isoformat() if d else None


UTCDateTime = Annotated[datetime, PlainSerializer(iso_utc, return_type=str)]
VehicleType = Literal["bike", "cng", "car"]
DETECTOR_ALERTS = {"route_deviation", "long_stop"}


class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


# --- auth ---------------------------------------------------------------------------------


class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=160)
    phone: str = Field(min_length=6, max_length=32)
    password: str = Field(min_length=6, max_length=72)
    role: Literal["user", "rider"] = "user"
    license_no: str | None = Field(default=None, max_length=40)
    vehicle_type: VehicleType | None = None
    plate_no: str | None = Field(default=None, max_length=32)
    vehicle_model: str | None = Field(default=None, max_length=60)


class LoginIn(BaseModel):
    email: str
    password: str


class ProfileOut(BaseModel):
    id: str
    full_name: str
    email: str
    phone: str
    role: str


class AuthOut(BaseModel):
    token: str
    profile: ProfileOut


# --- vehicles, riders -----------------------------------------------------------------------


class VehicleOut(BaseModel):
    id: str
    vehicle_type: str
    plate_no: str
    model: str
    verified: bool


class RiderPublic(BaseModel):
    id: str
    full_name: str
    phone: str
    rating: float | None
    rating_count: int
    vehicle: VehicleOut | None
    lat: float | None
    lng: float | None


# --- trips ----------------------------------------------------------------------------------


class EstimateIn(BaseModel):
    pickup: LatLng
    drop: LatLng


class QuoteOut(BaseModel):
    vehicle_type: str
    distance_km: float
    eta_min: float
    base_fare: float
    multiplier: float
    fare: float
    demand_level: str
    expected_requests: float
    available_riders: int
    nearest_pickup_eta_min: float | None
    zone_name: str
    reason: str
    breakdown: dict


class EstimateOut(BaseModel):
    pickup_address: str
    drop_address: str
    distance_km: float
    route: list[list[float]]
    route_source: str
    quotes: list[QuoteOut]


class TripCreate(BaseModel):
    pickup: LatLng
    drop: LatLng
    vehicle_type: VehicleType
    pickup_address: str | None = Field(default=None, max_length=160)
    drop_address: str | None = Field(default=None, max_length=160)


class RateIn(BaseModel):
    stars: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=500)


class PaymentOut(BaseModel):
    method: str
    amount: float
    status: str
    commission: float | None
    rider_earning: float | None
    collected_at: UTCDateTime | None


class TripOut(BaseModel):
    id: str
    status: str
    vehicle_type: str
    pickup: LatLng
    drop: LatLng
    pickup_address: str
    drop_address: str
    distance_km: float
    fare_estimate: float
    fare_final: float | None
    price_multiplier: float
    price_reason: str
    fare_breakdown: dict | None
    predicted_eta_min: float
    pickup_eta_min: float | None
    actual_duration_min: float | None
    cancelled_by: str | None
    cancel_reason: str | None
    auto_drive: bool
    route: list[list[float]]
    approach: list[list[float]]
    rider: RiderPublic | None
    passenger_name: str
    passenger_phone: str | None
    payment: PaymentOut | None
    rating: int | None
    rating_comment: str | None
    has_alert: bool
    sos_active: bool
    requested_at: UTCDateTime
    accepted_at: UTCDateTime | None
    arrived_at: UTCDateTime | None
    started_at: UTCDateTime | None
    completed_at: UTCDateTime | None


def vehicle_out(v: Vehicle | None) -> VehicleOut | None:
    if v is None:
        return None
    return VehicleOut(id=v.id, vehicle_type=v.vehicle_type, plate_no=v.plate_no, model=v.model, verified=v.verified)


def rider_rating(db: Session, rider_id: str) -> tuple[float | None, int]:
    avg, count = db.execute(
        select(func.avg(Rating.stars), func.count(Rating.id)).join(Trip, Trip.id == Rating.trip_id).where(Trip.rider_id == rider_id)
    ).one()
    return (round(float(avg), 2) if avg is not None else None), int(count)


def rider_public(db: Session, rider: Rider, vehicle: Vehicle | None = None) -> RiderPublic:
    rating, count = rider_rating(db, rider.id)
    return RiderPublic(
        id=rider.id,
        full_name=rider.profile.full_name,
        phone=rider.profile.phone,
        rating=rating,
        rating_count=count,
        vehicle=vehicle_out(vehicle or rider.vehicle),
        lat=rider.current_lat,
        lng=rider.current_lng,
    )


def trip_out(db: Session, trip: Trip, include_route: bool = True, for_rider: bool = False) -> TripOut:
    """`for_rider` hides passenger-only safety state (an SOS is never shown to the rider)."""
    alert_types = set(db.scalars(select(SafetyAlert.alert_type).where(SafetyAlert.trip_id == trip.id, SafetyAlert.status != "closed")))
    return TripOut(
        id=trip.id,
        status=trip.status,
        vehicle_type=trip.vehicle_type_requested,
        pickup=LatLng(lat=trip.pickup_lat, lng=trip.pickup_lng),
        drop=LatLng(lat=trip.drop_lat, lng=trip.drop_lng),
        pickup_address=trip.pickup_address,
        drop_address=trip.drop_address,
        distance_km=trip.distance_km,
        fare_estimate=float(trip.fare_estimate),
        fare_final=float(trip.fare_final) if trip.fare_final is not None else None,
        price_multiplier=trip.price_multiplier,
        price_reason=trip.price_reason,
        fare_breakdown=trip.fare_breakdown,
        predicted_eta_min=trip.predicted_eta_min,
        pickup_eta_min=trip.pickup_eta_min,
        actual_duration_min=trip.actual_duration_min,
        cancelled_by=trip.cancelled_by,
        cancel_reason=trip.cancel_reason,
        auto_drive=trip.auto_drive,
        route=trip.route if include_route else [],
        approach=trip.approach if include_route else [],
        rider=rider_public(db, trip.rider, trip.vehicle) if trip.rider else None,
        passenger_name=trip.user.full_name,
        # The rider can call the passenger only while the trip is in progress.
        passenger_phone=trip.user.phone if for_rider and trip.status in ("accepted", "ongoing") else None,
        payment=(
            PaymentOut(
                method=trip.payment.method,
                amount=trip.payment.amount,
                status=trip.payment.status,
                commission=trip.payment.commission if for_rider else None,
                rider_earning=trip.payment.rider_earning if for_rider else None,
                collected_at=trip.payment.collected_at,
            )
            if trip.payment
            else None
        ),
        rating=trip.rating.stars if trip.rating else None,
        rating_comment=(trip.rating.comment or None) if trip.rating else None,
        has_alert=bool(alert_types & DETECTOR_ALERTS),
        sos_active="sos" in alert_types and not for_rider,
        requested_at=trip.requested_at,
        accepted_at=trip.accepted_at,
        arrived_at=trip.arrived_at,
        started_at=trip.started_at,
        completed_at=trip.completed_at,
    )


class SosIn(BaseModel):
    note: str = Field(default="", max_length=300)


class ReportIn(BaseModel):
    category: Literal["safety", "driving", "fare", "rider_behaviour", "lost_item", "other"]
    note: str = Field(min_length=3, max_length=1000)


class SavedPlaceIn(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=160)


class SavedPlaceOut(BaseModel):
    id: str
    label: str
    lat: float
    lng: float
    address: str


class ProfileUpdateIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=6, max_length=32)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=72)


# --- rider portal ---------------------------------------------------------------------------


class OnlineIn(BaseModel):
    is_online: bool
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class LocationIn(LatLng):
    # From the device when available; otherwise computed from the previous fix.
    speed_kmh: float | None = Field(default=None, ge=0, le=250)
    accuracy_m: float | None = Field(default=None, ge=0, le=100_000)


class AutoDriveIn(BaseModel):
    enabled: bool


class OfferOut(BaseModel):
    trip: TripOut
    expires_at: UTCDateTime
    pickup_distance_km: float


class RiderMe(BaseModel):
    id: str
    full_name: str
    email: str
    phone: str
    license_no: str
    status: str
    is_online: bool
    lat: float | None
    lng: float | None
    vehicle: VehicleOut | None
    rating: float | None
    rating_count: int
    trips_completed: int
    earnings_today: float
    cancel_rate: float
    is_simulated: bool
    documents_ready: bool
    missing_documents: list[str]
    commission_due: float


# --- admin ----------------------------------------------------------------------------------


class AlertStatusIn(BaseModel):
    status: Literal["open", "reviewed", "closed"]


class PricingRuleIn(BaseModel):
    base_fare: float = Field(ge=0)
    per_km: float = Field(ge=0)
    per_min: float = Field(ge=0)
    min_fare: float = Field(ge=0)
    max_multiplier: float = Field(ge=1, le=3)
    commission_pct: float = Field(default=15, ge=0, le=50)


# --- assistant ------------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)


class BookingSuggestion(BaseModel):
    pickup_zone: str
    drop_zone: str
    vehicle_type: VehicleType
    pickup: LatLng
    drop: LatLng


class ChatOut(BaseModel):
    reply: str
    booking: BookingSuggestion | None
    source: Literal["groq", "fallback"]
