"""SQLAlchemy models. Tables follow the ER diagram in Docs/Project Proposal.md."""

import json
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow

VEHICLE_TYPES = ("bike", "cng", "car")
ACTIVE_TRIP_STATUSES = ("requested", "accepted", "ongoing")


def _uuid() -> str:
    return str(uuid.uuid4())


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(32))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(10))  # user, rider, admin
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    rider: Mapped["Rider | None"] = relationship(back_populates="profile", uselist=False)


class Rider(Base):
    __tablename__ = "riders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), unique=True)
    license_no: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending, verified, suspended
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    current_lat: Mapped[float | None] = mapped_column(Float)
    current_lng: Mapped[float | None] = mapped_column(Float)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime)

    profile: Mapped[Profile] = relationship(back_populates="rider")
    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="rider")

    @property
    def vehicle(self) -> "Vehicle | None":
        return self.vehicles[0] if self.vehicles else None


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rider_id: Mapped[str] = mapped_column(ForeignKey("riders.id"))
    vehicle_type: Mapped[str] = mapped_column(String(8))  # bike, cng, car
    plate_no: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(60))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)

    rider: Mapped[Rider] = relationship(back_populates="vehicles")


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    center_lat: Mapped[float] = mapped_column(Float)
    center_lng: Mapped[float] = mapped_column(Float)


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), index=True)
    rider_id: Mapped[str | None] = mapped_column(ForeignKey("riders.id"), index=True)
    vehicle_id: Mapped[str | None] = mapped_column(ForeignKey("vehicles.id"))
    pickup_zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), index=True)
    vehicle_type_requested: Mapped[str] = mapped_column(String(8))
    pickup_lat: Mapped[float] = mapped_column(Float)
    pickup_lng: Mapped[float] = mapped_column(Float)
    pickup_address: Mapped[str] = mapped_column(String(160), default="")
    drop_lat: Mapped[float] = mapped_column(Float)
    drop_lng: Mapped[float] = mapped_column(Float)
    drop_address: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(String(10), default="requested", index=True)
    distance_km: Mapped[float] = mapped_column(Float)
    fare_estimate: Mapped[float] = mapped_column(Float)
    fare_final: Mapped[float | None] = mapped_column(Float)
    price_multiplier: Mapped[float] = mapped_column(Float, default=1.0)
    price_reason: Mapped[str] = mapped_column(Text, default="")
    # Fare components at booking time, so receipts stay right after pricing rules change.
    fare_breakdown_json: Mapped[str | None] = mapped_column(Text)
    predicted_eta_min: Mapped[float] = mapped_column(Float)
    pickup_eta_min: Mapped[float | None] = mapped_column(Float)
    actual_duration_min: Mapped[float | None] = mapped_column(Float)
    cancelled_by: Mapped[str | None] = mapped_column(String(10))  # user, rider, system
    cancel_reason: Mapped[str | None] = mapped_column(String(160))

    # Matching state: the rider currently being offered this trip.
    offered_rider_id: Mapped[str | None] = mapped_column(ForeignKey("riders.id"))
    offered_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Route geometry as JSON [[lat, lng], ...]; approach is rider -> pickup.
    route_json: Mapped[str] = mapped_column(Text, default="[]")
    approach_json: Mapped[str] = mapped_column(Text, default="[]")

    # Simulation: auto_drive lets the backend simulator move the rider along the route.
    auto_drive: Mapped[bool] = mapped_column(Boolean, default=False)
    sim_progress_km: Mapped[float] = mapped_column(Float, default=0.0)

    requested_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime)  # rider reached the pickup
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    user: Mapped[Profile] = relationship(foreign_keys=[user_id])
    rider: Mapped[Rider | None] = relationship(foreign_keys=[rider_id])
    vehicle: Mapped[Vehicle | None] = relationship()
    pickup_zone: Mapped[Zone | None] = relationship()
    rating: Mapped["Rating | None"] = relationship(back_populates="trip", uselist=False)
    payment: Mapped["Payment | None"] = relationship(back_populates="trip", uselist=False)

    @property
    def route(self) -> list[list[float]]:
        return json.loads(self.route_json or "[]")

    @route.setter
    def route(self, points: list) -> None:
        self.route_json = json.dumps([[round(p[0], 6), round(p[1], 6)] for p in points])

    @property
    def approach(self) -> list[list[float]]:
        return json.loads(self.approach_json or "[]")

    @approach.setter
    def approach(self, points: list) -> None:
        self.approach_json = json.dumps([[round(p[0], 6), round(p[1], 6)] for p in points])

    @property
    def fare_breakdown(self) -> dict | None:
        return json.loads(self.fare_breakdown_json) if self.fare_breakdown_json else None


class SavedPlace(Base):
    __tablename__ = "saved_places"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), index=True)
    label: Mapped[str] = mapped_column(String(40))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    address: Mapped[str] = mapped_column(String(160), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TripLocation(Base):
    __tablename__ = "trip_locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    accuracy_m: Mapped[float | None] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Rating(Base):
    __tablename__ = "ratings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id"), unique=True)
    stars: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trip: Mapped[Trip] = relationship(back_populates="rating")


class MatchScore(Base):
    __tablename__ = "match_scores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id"), index=True)
    rider_id: Mapped[str] = mapped_column(ForeignKey("riders.id"))
    pickup_eta_min: Mapped[float] = mapped_column(Float)
    cancel_probability: Mapped[float] = mapped_column(Float)
    score: Mapped[float] = mapped_column(Float)
    rank: Mapped[int] = mapped_column(Integer)
    # candidate, offered, declined, expired, accepted
    status: Mapped[str] = mapped_column(String(10), default="candidate")


class DemandForecast(Base):
    __tablename__ = "demand_forecasts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"), index=True)
    vehicle_type: Mapped[str] = mapped_column(String(8))
    forecast_for: Mapped[datetime] = mapped_column(DateTime, index=True)
    predicted_requests: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SafetyAlert(Base):
    __tablename__ = "safety_alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id"), index=True)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("profiles.id"))
    alert_type: Mapped[str] = mapped_column(String(20))  # route_deviation, long_stop (detector); sos, report (passenger)
    anomaly_score: Mapped[float] = mapped_column(Float)
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    summary: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open, reviewed, closed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trip: Mapped[Trip] = relationship()

    @property
    def details(self) -> dict:
        return json.loads(self.details_json or "{}")


class PricingRule(Base):
    __tablename__ = "pricing_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vehicle_type: Mapped[str] = mapped_column(String(8), unique=True)
    base_fare: Mapped[float] = mapped_column(Float)
    per_km: Mapped[float] = mapped_column(Float)
    per_min: Mapped[float] = mapped_column(Float)
    min_fare: Mapped[float] = mapped_column(Float)
    max_multiplier: Mapped[float] = mapped_column(Float)
    # Platform share of each fare, in percent; None falls back to settings.default_commission_pct.
    commission_pct: Mapped[float | None] = mapped_column(Float)


class WeatherHourly(Base):
    __tablename__ = "weather_hourly"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime, unique=True, index=True)
    temperature_c: Mapped[float] = mapped_column(Float)
    precipitation_mm: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(20), default="open-meteo")


class Payment(Base):
    """Cash collected by the rider at drop-off. The platform's commission is owed by the rider."""

    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id"), unique=True)
    rider_id: Mapped[str] = mapped_column(ForeignKey("riders.id"), index=True)
    method: Mapped[str] = mapped_column(String(10), default="cash")
    amount: Mapped[float] = mapped_column(Float)
    commission_pct: Mapped[float] = mapped_column(Float)
    commission: Mapped[float] = mapped_column(Float)
    rider_earning: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending, collected, disputed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    collected_at: Mapped[datetime | None] = mapped_column(DateTime)

    trip: Mapped[Trip] = relationship(back_populates="payment")


class Settlement(Base):
    """Commission a rider has paid over to the platform (recorded by an admin)."""

    __tablename__ = "settlements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rider_id: Mapped[str] = mapped_column(ForeignKey("riders.id"), index=True)
    amount: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(String(200), default="")
    recorded_by: Mapped[str] = mapped_column(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


DOCUMENT_TYPES = ("license", "registration", "photo")


class RiderDocument(Base):
    __tablename__ = "rider_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rider_id: Mapped[str] = mapped_column(ForeignKey("riders.id"), index=True)
    doc_type: Mapped[str] = mapped_column(String(20))  # license, registration, photo
    stored_name: Mapped[str] = mapped_column(String(80))
    original_name: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(60))
    size_bytes: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending, approved, rejected
    review_note: Mapped[str | None] = mapped_column(String(300))
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("profiles.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
