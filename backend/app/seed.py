"""Database setup data.

- Reference data (always): the Dhaka zones and the pricing rules.
- First admin (always, if none exists): from ADMIN_EMAIL / ADMIN_PASSWORD.
- Demo data (DEMO_MODE=true only): demo accounts, simulated riders and 14 days of synthetic trips.

The synthetic history gives the demand baseline something to average and the dashboards
something to show. It is NOT training data for the final models (those use NYC TLC / Chicago);
it only has a realistic daily shape.

    python -m app.seed --reset          # empty real-mode database (reference data + admin)
    python -m app.seed --reset --demo   # demo database
"""

import argparse
import json
import logging
import math
import random
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Base, SessionLocal, create_schema, engine, utcnow
from app.geo import haversine_km, offset_point
from app.models import DOCUMENT_TYPES, Payment, PricingRule, Profile, Rating, Rider, RiderDocument, Trip, Vehicle, Zone
from app.security import hash_password
from app.services import documents
from app.services.predictors import eta_predictor
from app.services.pricing import fare_breakdown
from app.services.routing import DETOUR_FACTOR

log = logging.getLogger(__name__)

ZONES = [
    (1, "Gulshan", 23.7808, 90.4167),
    (2, "Banani", 23.7937, 90.4043),
    (3, "Dhanmondi", 23.7461, 90.3742),
    (4, "Mirpur", 23.8223, 90.3654),
    (5, "Uttara", 23.8759, 90.3795),
    (6, "Motijheel", 23.7330, 90.4172),
    (7, "Mohakhali", 23.7781, 90.4007),
    (8, "Bashundhara", 23.8193, 90.4526),
    (9, "Farmgate", 23.7577, 90.3897),
    (10, "Old Dhaka", 23.7086, 90.4060),
    (11, "Rampura", 23.7612, 90.4224),
    (12, "Mohammadpur", 23.7662, 90.3589),
]
# Relative demand per zone (business districts busier).
ZONE_WEIGHT = {1: 1.6, 2: 1.3, 3: 1.4, 4: 1.2, 5: 1.1, 6: 1.5, 7: 1.1, 8: 0.9, 9: 1.3, 10: 0.8, 11: 0.8, 12: 0.9}
# Share of requests by local hour: morning and evening peaks.
HOUR_WEIGHT = [0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 1.0, 1.8, 2.6, 2.8, 2.0, 1.6, 1.5, 1.6, 1.5, 1.6, 2.0, 2.6, 3.0, 2.8, 2.2, 1.5, 0.9, 0.5]
VEHICLE_MIX = {"bike": 0.5, "cng": 0.28, "car": 0.22}

# id, vehicle type, base, per km, per min, minimum, max multiplier, commission %
PRICING = [
    (1, "bike", 20, 12, 1.0, 40, 1.5, 15),
    (2, "cng", 30, 18, 1.5, 60, 1.5, 12),
    (3, "car", 50, 30, 3.0, 120, 1.8, 18),
]

VEHICLE_MODELS = {
    "bike": ["Bajaj Pulsar 150", "Yamaha FZ-S", "TVS Apache RTR", "Honda CB Hornet", "Suzuki Gixxer"],
    "cng": ["Bajaj RE CNG", "TVS King CNG"],
    "car": ["Toyota Axio", "Toyota Premio", "Toyota Allion", "Honda Grace", "Nissan Sunny"],
}
PLATE_CLASS = {"bike": "HA", "cng": "THA", "car": "GA"}
FIRST = ["Rahim", "Karim", "Sabbir", "Nayeem", "Tanvir", "Rafiq", "Jahid", "Imran", "Sumon", "Arif", "Shakil", "Masud",
         "Rubel", "Hasan", "Fahim", "Sajid", "Mamun", "Rakib", "Nasrin", "Farzana", "Sadia", "Nusrat", "Tania", "Mitu"]
LAST = ["Ahmed", "Hossain", "Islam", "Rahman", "Uddin", "Chowdhury", "Sarker", "Mia", "Khan", "Akter", "Begum", "Alam"]

SIM_RIDERS = {"bike": 7, "cng": 6, "car": 5}
HISTORY_DAYS = 14
TRIPS_PER_DAY = 420


def _name(rng: random.Random) -> str:
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def _plate(rng: random.Random, vt: str) -> str:
    return f"DHAKA METRO-{PLATE_CLASS[vt]} {rng.randint(11, 99)}-{rng.randint(1000, 9999)}"


def _jitter(rng: random.Random, lat: float, lng: float, km: float) -> tuple[float, float]:
    r, theta = km * math.sqrt(rng.random()), rng.uniform(0, 2 * math.pi)
    return offset_point((lat, lng), r * math.cos(theta), r * math.sin(theta))


def _profile(email: str, name: str, role: str, password_hash: str, rng: random.Random) -> Profile:
    return Profile(full_name=name, email=email, phone=f"+8801{rng.randint(3, 9)}{rng.randint(10000000, 99999999)}", password_hash=password_hash, role=role)


def seed_reference(db: Session) -> None:
    """Zones and pricing rules: needed in every mode, added only if missing."""
    if not db.scalar(select(Zone.id).limit(1)):
        db.add_all(Zone(id=i, name=n, center_lat=lat, center_lng=lng) for i, n, lat, lng in ZONES)
    if not db.scalar(select(PricingRule.id).limit(1)):
        db.add_all(
            PricingRule(id=i, vehicle_type=vt, base_fare=b, per_km=km, per_min=m, min_fare=mn, max_multiplier=mx, commission_pct=c)
            for i, vt, b, km, m, mn, mx, c in PRICING
        )
    db.commit()


def ensure_admin(db: Session) -> str | None:
    """Create the first admin from settings if there is no admin yet. Returns the email if created."""
    if db.scalar(select(Profile.id).where(Profile.role == "admin").limit(1)):
        return None
    if not (settings.admin_email and settings.admin_password):
        log.warning("No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (backend/.env) and restart.")
        return None
    email = settings.admin_email.strip().lower()
    db.add(Profile(full_name=settings.admin_name, email=email, phone="", password_hash=hash_password(settings.admin_password), role="admin"))
    db.commit()
    return email


def _demo_documents(db: Session, rider: Rider, status: str) -> None:
    for doc_type in DOCUMENT_TYPES:
        data = documents.placeholder_png(f"Demo {doc_type}")
        db.add(
            RiderDocument(
                rider_id=rider.id,
                doc_type=doc_type,
                stored_name=documents.store_bytes(data, "image/png"),
                original_name=f"demo-{doc_type}.png",
                content_type="image/png",
                size_bytes=len(data),
                status=status,
            )
        )


def seed_demo(db: Session, rng: random.Random | None = None) -> bool:
    """Demo accounts, simulated riders and synthetic history. Returns False if already present."""
    if db.scalar(select(Profile.id).where(Profile.email == "user@ride.local")):
        return False
    rng = rng or random.Random(42)
    seed_reference(db)

    if not db.scalar(select(Profile.id).where(Profile.email == "admin@ride.local")):
        db.add(_profile("admin@ride.local", "Platform Admin", "admin", hash_password("admin123"), rng))
    demo_user = _profile("user@ride.local", "Demo Passenger", "user", hash_password("user123"), rng)
    db.add(demo_user)

    demo_rider_profile = _profile("rider@ride.local", "Demo Rider", "rider", hash_password("rider123"), rng)
    pending_profile = _profile("pending@ride.local", "Pending Rider", "rider", hash_password("rider123"), rng)
    db.add_all([demo_rider_profile, pending_profile])
    db.flush()

    demo_rider = Rider(profile_id=demo_rider_profile.id, license_no="DK-0451278", status="verified", current_lat=23.7815, current_lng=90.4140)
    pending = Rider(profile_id=pending_profile.id, license_no="DK-0983311", status="pending")
    db.add_all([demo_rider, pending])
    db.flush()
    db.add(Vehicle(rider_id=demo_rider.id, vehicle_type="bike", plate_no=_plate(rng, "bike"), model="Yamaha FZ-S", verified=True))
    db.add(Vehicle(rider_id=pending.id, vehicle_type="car", plate_no=_plate(rng, "car"), model="Toyota Axio"))
    _demo_documents(db, demo_rider, "approved")
    _demo_documents(db, pending, "pending")

    # Simulated riders and passengers share one hash of a random password: they cannot log in.
    locked = hash_password(secrets.token_urlsafe(16))
    sim_riders: dict[str, list[tuple[Rider, Vehicle, float]]] = {vt: [] for vt in SIM_RIDERS}
    n = 0
    for vt, count in SIM_RIDERS.items():
        for _ in range(count):
            n += 1
            prof = _profile(f"sim-rider-{n}@ride.local", _name(rng), "rider", locked, rng)
            db.add(prof)
            db.flush()
            _, _, zlat, zlng = rng.choice(ZONES)
            lat, lng = _jitter(rng, zlat, zlng, 1.5)
            r = Rider(profile_id=prof.id, license_no=f"DK-{rng.randint(1000000, 9999999)}", status="verified", is_online=True,
                      is_simulated=True, current_lat=lat, current_lng=lng, last_seen=utcnow())
            db.add(r)
            db.flush()
            v = Vehicle(rider_id=r.id, vehicle_type=vt, plate_no=_plate(rng, vt), model=rng.choice(VEHICLE_MODELS[vt]), verified=True)
            db.add(v)
            db.flush()
            sim_riders[vt].append((r, v, rng.uniform(0.01, 0.14)))  # per-rider cancel propensity

    passengers = [demo_user]
    for i in range(30):
        p = _profile(f"passenger-{i + 1}@ride.local", _name(rng), "user", locked, rng)
        db.add(p)
        passengers.append(p)
    db.flush()

    _seed_history(db, rng, sim_riders, passengers)
    db.commit()
    return True


def _seed_history(db: Session, rng: random.Random, sim_riders: dict, passengers: list[Profile]) -> None:
    now = utcnow()
    rules = {vt: (b, km, m, mn) for _, vt, b, km, m, mn, _, _ in PRICING}
    commission = {vt: c for _, vt, *_, c in PRICING}
    zone_ids = [z[0] for z in ZONES]
    zone_w = [ZONE_WEIGHT[z] for z in zone_ids]
    zones = {z[0]: z for z in ZONES}
    # Local slowdowns the distance/speed baseline does not know about (room for a learned ETA model).
    slow_zone = {6: 1.25, 10: 1.35, 9: 1.15}

    trips, ratings, payments = [], [], []
    total_hour_w = sum(HOUR_WEIGHT)
    # Day 0 is today up to now, so the dashboard has a live-looking "today" on a fresh database.
    for day in range(HISTORY_DAYS, -1, -1):
        local_midnight = (now + timedelta(hours=6)).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=day)
        weekend = local_midnight.weekday() in (4, 5)
        day_trips = int(TRIPS_PER_DAY * (0.8 if weekend else 1.0) * rng.uniform(0.9, 1.1))
        for hour, w in enumerate(HOUR_WEIGHT):
            for _ in range(round(day_trips * w / total_hour_w)):
                requested_local = local_midnight + timedelta(hours=hour, seconds=rng.randint(0, 3599))
                requested = requested_local - timedelta(hours=6)
                if requested >= now:
                    continue
                zid = rng.choices(zone_ids, zone_w)[0]
                did = rng.choice([z for z in zone_ids if z != zid])
                _, pname, plat, plng = zones[zid]
                _, dname, dlat, dlng = zones[did]
                pickup, drop = _jitter(rng, plat, plng, 1.2), _jitter(rng, dlat, dlng, 1.2)
                vt = rng.choices(list(VEHICLE_MIX), list(VEHICLE_MIX.values()))[0]
                rider, vehicle, cancel_p = rng.choice(sim_riders[vt])

                dist = round(max(0.5, haversine_km(pickup, drop) * DETOUR_FACTOR * rng.uniform(0.9, 1.15)), 2)
                eta = eta_predictor.predict_eta(dist, vt, requested)
                b, km, m, mn = rules[vt]
                peak = hour in (8, 9, 17, 18, 19)
                mult = round(rng.uniform(1.1, 1.4), 1) if peak and rng.random() < 0.35 else 1.0
                breakdown = fare_breakdown(b, km, m, mn, dist, eta, mult)
                fare = breakdown["total"]
                pickup_eta = round(rng.uniform(2, 11), 1)

                roll = rng.random()
                status, cancelled_by = "completed", None
                if roll < cancel_p:
                    status, cancelled_by = "cancelled", "rider"
                elif roll < cancel_p + 0.06:
                    status, cancelled_by = "cancelled", "user"
                elif roll < cancel_p + 0.08:
                    status, cancelled_by = "cancelled", "system"

                accepted = requested + timedelta(seconds=rng.randint(5, 40)) if cancelled_by != "system" else None
                started = completed = actual = None
                if status == "completed":
                    started = accepted + timedelta(minutes=pickup_eta)
                    factor = slow_zone.get(zid, 1.0) * slow_zone.get(did, 1.0) ** 0.5 * (1.15 if vt == "car" and peak else 1.0)
                    actual = round(eta * factor * rng.lognormvariate(0, 0.18), 1)
                    completed = started + timedelta(minutes=actual)
                elif cancelled_by:
                    completed = requested + timedelta(minutes=rng.uniform(0.5, 4))

                trip_id = str(uuid.uuid4())
                trips.append(
                    {
                        "id": trip_id,
                        "user_id": rng.choice(passengers).id,
                        "rider_id": rider.id if accepted else None,
                        "vehicle_id": vehicle.id if accepted else None,
                        "pickup_zone_id": zid,
                        "vehicle_type_requested": vt,
                        "pickup_lat": pickup[0], "pickup_lng": pickup[1], "pickup_address": f"Near {pname}",
                        "drop_lat": drop[0], "drop_lng": drop[1], "drop_address": f"Near {dname}",
                        "status": status,
                        "distance_km": dist,
                        "fare_estimate": fare,
                        "fare_final": fare if status == "completed" else None,
                        "price_multiplier": mult,
                        "price_reason": "",
                        "fare_breakdown_json": json.dumps(breakdown),
                        "predicted_eta_min": eta,
                        "pickup_eta_min": pickup_eta,
                        "actual_duration_min": actual,
                        "cancelled_by": cancelled_by,
                        "cancel_reason": {"rider": "Cancelled by rider", "user": "Cancelled by passenger", "system": "No rider accepted the request"}.get(cancelled_by),
                        "route_json": "[]", "approach_json": "[]",
                        "auto_drive": False, "sim_progress_km": 0.0,
                        "requested_at": requested, "accepted_at": accepted, "arrived_at": started, "started_at": started, "completed_at": completed,
                    }
                )
                if status == "completed":
                    cut = round(fare * commission[vt] / 100)
                    payments.append(
                        {
                            "id": str(uuid.uuid4()), "trip_id": trip_id, "rider_id": rider.id, "method": "cash", "amount": fare,
                            "commission_pct": commission[vt], "commission": cut, "rider_earning": fare - cut,
                            "status": "collected", "created_at": completed, "collected_at": completed,
                        }
                    )
                    if rng.random() < 0.6:
                        stars = rng.choices([5, 4, 3, 2, 1], [50, 30, 12, 5, 3])[0]
                        ratings.append({"id": str(uuid.uuid4()), "trip_id": trip_id, "stars": stars, "comment": "", "created_at": completed})

    db.execute(insert(Trip), trips)
    if ratings:
        db.execute(insert(Rating), ratings)
    if payments:
        db.execute(insert(Payment), payments)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="drop all tables first (deletes all data)")
    parser.add_argument("--demo", action="store_true", help="add demo accounts, simulated riders and synthetic trips")
    args = parser.parse_args()
    if args.reset:
        Base.metadata.drop_all(engine)
    create_schema()
    with SessionLocal() as db:
        seed_reference(db)
        admin = ensure_admin(db)
        print(f"admin account created: {admin}" if admin else "admin: existing account kept (or ADMIN_EMAIL/ADMIN_PASSWORD not set)")
        if args.demo:
            print("demo data added" if seed_demo(db) else "demo data already present")


if __name__ == "__main__":
    main()
