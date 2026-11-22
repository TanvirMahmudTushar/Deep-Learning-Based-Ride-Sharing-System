from datetime import timedelta
import uuid

import pytest
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal, utcnow
from app.models import MatchScore, Profile, Rider, Trip, Vehicle
from app.security import hash_password
from app.services import matching, trips

GULSHAN = (23.7810, 90.4150)
DHANMONDI = (23.7465, 90.3745)


def _create_rider(db, *, lat=23.7812, lng=90.4152, vehicle_type="bike") -> tuple[Profile, Rider, Vehicle]:
    uid = uuid.uuid4().hex[:8]
    profile = Profile(
        full_name=f"Match Rider {uid}",
        phone=f"+88017{uid[:8]}",
        email=f"match-rider-{uid}@ride.local",
        password_hash=hash_password("pass123"),
        role="rider",
        account_status="active",
        phone_verified=True,
    )
    db.add(profile)
    db.flush()
    rider = Rider(
        profile_id=profile.id,
        license_no=f"DL-{uid}",
        status="verified",
        is_online=True,
        is_simulated=False,
        current_lat=lat,
        current_lng=lng,
        last_seen=utcnow(),
    )
    db.add(rider)
    db.flush()
    vehicle = Vehicle(
        rider_id=rider.id,
        vehicle_type=vehicle_type,
        plate_no=f"DM-{uid}",
        model="Test Bike",
        verified=True,
    )
    db.add(vehicle)
    db.flush()
    return profile, rider, vehicle


@pytest.fixture
def isolated_riders(client):
    created_rider_ids: list[str] = []

    def _make(**kwargs):
        with SessionLocal() as db:
            p, r, v = _create_rider(db, **kwargs)
            db.commit()
            created_rider_ids.append(r.id)
            return p.id, r.id, v.id

    yield _make

    with SessionLocal() as db:
        for rid in created_rider_ids:
            r = db.get(Rider, rid)
            if r is not None:
                r.is_online = False
        db.commit()


def test_offer_next_cascades_past_disqualified_candidates(client, isolated_riders):
    p_user_email = "user@ride.local"
    with SessionLocal() as db:
        passenger = db.scalar(select(Profile).where(Profile.email == p_user_email))
        assert passenger is not None

        trip = Trip(
            user_id=passenger.id,
            vehicle_type_requested="bike",
            pickup_lat=GULSHAN[0],
            pickup_lng=GULSHAN[1],
            pickup_address="Gulshan",
            drop_lat=DHANMONDI[0],
            drop_lng=DHANMONDI[1],
            drop_address="Dhanmondi",
            distance_km=5.0,
            fare_estimate=120.0,
            predicted_eta_min=15.0,
        )
        db.add(trip)
        db.flush()

        # Create 8 riders: r0 (initial offer, will decline), 6 disqualified in different ways, and r_valid.
        _, r0, _ = _create_rider(db)
        _, r_offline, _ = _create_rider(db)
        _, r_stale, _ = _create_rider(db)
        p_susp, r_susp_acct, _ = _create_rider(db)
        _, r_susp_rider, _ = _create_rider(db)
        _, r_veh, v_old = _create_rider(db)
        _, r_range, _ = _create_rider(db)
        _, r_valid, _ = _create_rider(db)

        r0_id, r_offline_id, r_stale_id = r0.id, r_offline.id, r_stale.id
        p_susp_id, r_susp_acct_id, r_susp_rider_id = p_susp.id, r_susp_acct.id, r_susp_rider.id
        r_veh_id, v_old_id, r_range_id, r_valid_id = r_veh.id, v_old.id, r_range.id, r_valid.id

        ranked_ids = [
            r0_id,
            r_offline_id,
            r_stale_id,
            r_susp_acct_id,
            r_susp_rider_id,
            r_veh_id,
            r_range_id,
            r_valid_id,
        ]
        for idx, rid in enumerate(ranked_ids, start=1):
            db.add(
                MatchScore(
                    trip_id=trip.id,
                    rider_id=rid,
                    pickup_eta_min=float(idx),
                    cancel_probability=0.05,
                    score=float(idx),
                    rank=idx,
                    status="offered" if idx == 1 else "candidate",
                )
            )
        trip.offered_rider_id = r0_id
        trip.offered_at = utcnow()
        db.flush()

        # Disqualify each queued candidate in a distinct way.
        db.get(Rider, r_offline_id).is_online = False
        db.get(Rider, r_stale_id).last_seen = utcnow() - timedelta(seconds=settings.rider_stale_seconds + 10)
        db.get(Profile, p_susp_id).account_status = "suspended"
        db.get(Rider, r_susp_rider_id).status = "suspended"

        # Retire old bike and give rider a verified car instead.
        old_veh = db.get(Vehicle, v_old_id)
        old_veh.retired_at = utcnow()
        db.add(Vehicle(rider_id=r_veh_id, vehicle_type="car", plate_no="DM-CAR-1", model="Car", verified=True))

        # Move r_range outside match_radius_km.
        far_rider = db.get(Rider, r_range_id)
        far_rider.current_lat = 23.95
        far_rider.current_lng = 90.65

        # r0 declines, triggering offer_next().
        matching.set_offer_status(db, trip, r0_id, "declined")
        advanced = matching.offer_next(db, trip)
        db.flush()

        assert advanced is True
        assert trip.offered_rider_id == r_valid_id

        scores = {
            ms.rider_id: ms.status
            for ms in db.scalars(select(MatchScore).where(MatchScore.trip_id == trip.id)).all()
        }
        assert scores[r0_id] == "declined"
        for disqualified_id in (
            r_offline_id,
            r_stale_id,
            r_susp_acct_id,
            r_susp_rider_id,
            r_veh_id,
            r_range_id,
        ):
            assert scores[disqualified_id] == "expired"
        assert scores[r_valid_id] == "offered"

        db.rollback()


def test_offer_next_returns_false_and_cancels_when_all_queued_disqualified(client):
    with SessionLocal() as db:
        passenger = db.scalar(select(Profile).where(Profile.email == "user@ride.local"))
        assert passenger is not None

        # Ensure no unrelated riders are online nearby for rank_candidates fallback.
        for r in db.scalars(select(Rider).where(Rider.is_online.is_(True))).all():
            r.is_online = False

        trip = Trip(
            user_id=passenger.id,
            vehicle_type_requested="bike",
            pickup_lat=GULSHAN[0],
            pickup_lng=GULSHAN[1],
            pickup_address="Gulshan",
            drop_lat=DHANMONDI[0],
            drop_lng=DHANMONDI[1],
            drop_address="Dhanmondi",
            distance_km=5.0,
            fare_estimate=120.0,
            predicted_eta_min=15.0,
        )
        db.add(trip)
        db.flush()

        _, r0, _ = _create_rider(db)
        _, r1, v1 = _create_rider(db)
        _, r2, _ = _create_rider(db)
        r0_id, r1_id, v1_id, r2_id = r0.id, r1.id, v1.id, r2.id

        for idx, rid in enumerate((r0_id, r1_id, r2_id), start=1):
            db.add(
                MatchScore(
                    trip_id=trip.id,
                    rider_id=rid,
                    pickup_eta_min=float(idx),
                    cancel_probability=0.05,
                    score=float(idx),
                    rank=idx,
                    status="offered" if idx == 1 else "candidate",
                )
            )
        trip.offered_rider_id = r0_id
        trip.offered_at = utcnow()
        db.flush()

        # Unverify r1's vehicle and take r2 offline.
        db.get(Vehicle, v1_id).verified = False
        db.get(Rider, r2_id).is_online = False

        # r0 expires -> advance_offer() should expire r1 & r2 and cancel the trip.
        matching.set_offer_status(db, trip, r0_id, "expired")
        trips.advance_offer(db, trip)
        db.flush()

        assert trip.offered_rider_id is None
        assert trip.offered_at is None
        assert trip.status == "cancelled"
        assert trip.cancelled_by == "system"

        scores = {
            ms.rider_id: ms.status
            for ms in db.scalars(select(MatchScore).where(MatchScore.trip_id == trip.id)).all()
        }
        assert scores == {r0_id: "expired", r1_id: "expired", r2_id: "expired"}

        db.rollback()
