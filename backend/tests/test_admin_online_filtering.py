from datetime import timedelta

from app.config import settings
from app.db import SessionLocal, utcnow
from app.models import Profile, Rider, Vehicle


def _make_rider(
    db,
    *,
    email: str,
    status: str,
    account_status: str = "active",
    is_online: bool = True,
    last_seen=None,
    vehicle_type: str = "bike",
    vehicle_verified: bool = True,
) -> tuple[str, str]:
    profile = Profile(
        full_name=f"Test {email}",
        phone="+8801700000999",
        email=email,
        password_hash="not-used-in-direct-db-test",
        role="rider",
        account_status=account_status,
    )
    db.add(profile)
    db.flush()
    rider = Rider(
        profile_id=profile.id,
        license_no=f"LIC-{email[:10]}",
        status=status,
        is_online=is_online,
        is_simulated=False,
        current_lat=23.8103,
        current_lng=90.4125,
        last_seen=last_seen,
    )
    db.add(rider)
    db.flush()
    vehicle = Vehicle(
        rider_id=rider.id,
        vehicle_type=vehicle_type,
        plate_no=f"DHAKA-{rider.id[:6].upper()}",
        model="Test Model",
        verified=vehicle_verified,
    )
    db.add(vehicle)
    db.flush()
    return profile.id, rider.id


def test_admin_excludes_stale_unverified_and_suspended_riders(client, admin_h):
    now = utcnow()
    stale_time = now - timedelta(seconds=settings.rider_stale_seconds + 30)

    with SessionLocal() as db:
        _, valid_id = _make_rider(
            db,
            email="valid.fresh@example.com",
            status="verified",
            account_status="active",
            is_online=True,
            last_seen=now,
            vehicle_type="car",
            vehicle_verified=True,
        )
        _, stale_id = _make_rider(
            db,
            email="stale.heartbeat@example.com",
            status="verified",
            account_status="active",
            is_online=True,
            last_seen=stale_time,
            vehicle_type="car",
            vehicle_verified=True,
        )
        _, no_heartbeat_id = _make_rider(
            db,
            email="no.heartbeat@example.com",
            status="verified",
            account_status="active",
            is_online=True,
            last_seen=None,
            vehicle_type="car",
            vehicle_verified=True,
        )
        _, pending_id = _make_rider(
            db,
            email="pending.unverified@example.com",
            status="pending",
            account_status="active",
            is_online=True,
            last_seen=now,
            vehicle_type="car",
            vehicle_verified=False,
        )
        _, suspended_profile_id = _make_rider(
            db,
            email="suspended.profile@example.com",
            status="verified",
            account_status="suspended",
            is_online=True,
            last_seen=now,
            vehicle_type="car",
            vehicle_verified=True,
        )
        _, suspended_rider_id = _make_rider(
            db,
            email="suspended.rider@example.com",
            status="suspended",
            account_status="active",
            is_online=True,
            last_seen=now,
            vehicle_type="car",
            vehicle_verified=True,
        )
        db.commit()

    # 1. Live map (/api/admin/trips/live)
    live = client.get("/api/admin/trips/live", headers=admin_h)
    assert live.status_code == 200, live.text
    live_ids = {r["id"] for r in live.json()["riders"]}
    assert valid_id in live_ids
    assert stale_id not in live_ids
    assert no_heartbeat_id not in live_ids
    assert pending_id not in live_ids
    assert suspended_profile_id not in live_ids
    assert suspended_rider_id not in live_ids

    # 2. Stats (/api/admin/stats) should match live_ids count (none of the 5 ghost riders counted)
    stats = client.get("/api/admin/stats", headers=admin_h)
    assert stats.status_code == 200, stats.text
    assert stats.json()["online_riders"] == len(live_ids)

    # 3. Forecasts (/api/admin/forecasts) supply should not count the 5 ghost riders
    forecasts = client.get("/api/admin/forecasts", headers=admin_h)
    assert forecasts.status_code == 200, forecasts.text
    total_free = sum(z["free_riders"] for z in forecasts.json()["zones"])
    # Only non-busy riders in live_ids with verified vehicles are counted in free_riders
    assert total_free <= len(live_ids)

    # 4. Accounts & Riders endpoints report is_online=False for ghost riders and True for valid rider
    accounts = client.get(
        "/api/admin/accounts",
        headers=admin_h,
        params={"role_filter": "rider", "limit": 100},
    )
    assert accounts.status_code == 200, accounts.text
    by_rider_id = {item["rider_id"]: item for item in accounts.json()["items"] if item["rider_id"]}
    assert by_rider_id[valid_id]["is_online"] is True
    assert by_rider_id[stale_id]["is_online"] is False
    assert by_rider_id[no_heartbeat_id]["is_online"] is False
    assert by_rider_id[pending_id]["is_online"] is False
    assert by_rider_id[suspended_profile_id]["is_online"] is False
    assert by_rider_id[suspended_rider_id]["is_online"] is False

    riders = client.get("/api/admin/riders", headers=admin_h)
    assert riders.status_code == 200, riders.text
    riders_by_id = {item["id"]: item for item in riders.json()}
    assert riders_by_id[valid_id]["is_online"] is True
    assert riders_by_id[stale_id]["is_online"] is False
    assert riders_by_id[no_heartbeat_id]["is_online"] is False
    assert riders_by_id[pending_id]["is_online"] is False
    assert riders_by_id[suspended_profile_id]["is_online"] is False
    assert riders_by_id[suspended_rider_id]["is_online"] is False
