from datetime import timedelta

from sqlalchemy import delete, select

from app.db import SessionLocal, utcnow
from app.models import Profile, Rider, RiderPreference, Trip, Vehicle, VehicleChange


def _trip(user_id: str, rider_id: str | None, status: str, cancelled_by: str | None, at):
    return Trip(
        user_id=user_id,
        rider_id=rider_id,
        vehicle_type_requested="bike",
        pickup_lat=23.78,
        pickup_lng=90.41,
        drop_lat=23.75,
        drop_lng=90.37,
        pickup_address="Gulshan",
        drop_address="Dhanmondi",
        status=status,
        distance_km=5,
        fare_estimate=150,
        fare_final=150 if status == "completed" else None,
        predicted_eta_min=20,
        cancelled_by=cancelled_by,
        cancel_reason="Test cancellation" if cancelled_by else None,
        requested_at=at,
    )


def test_admin_accounts_search_stats_history_and_status_actions(client, admin_h):
    passenger_response = client.post(
        "/api/auth/register",
        json={
            "full_name": "Account Test Passenger",
            "email": "account.stats@example.com",
            "phone": "+8801700000011",
            "password": "secret123",
            "otp": "000000",
        },
    )
    assert passenger_response.status_code == 201, passenger_response.text
    passenger_id = passenger_response.json()["profile"]["id"]
    passenger_token = passenger_response.json()["token"]

    rider_response = client.post(
        "/api/auth/register",
        json={
            "full_name": "Account Test Rider",
            "email": "account.rider@example.com",
            "phone": "+8801700000012",
            "password": "secret123",
            "role": "rider",
            "otp": "000000",
            "license_no": "ACCOUNT-TEST-LICENSE",
            "vehicle_type": "bike",
            "plate_no": "DHAKA TEST 11-1111",
            "vehicle_model": "Test Bike",
        },
    )
    assert rider_response.status_code == 201, rider_response.text
    rider_profile_id = rider_response.json()["profile"]["id"]

    with SessionLocal() as db:
        rider = db.scalar(select(Rider).where(Rider.profile_id == rider_profile_id))
        assert rider is not None
        at = utcnow()
        db.add_all(
            [
                _trip(passenger_id, rider.id, "completed", None, at),
                _trip(passenger_id, rider.id, "cancelled", "user", at + timedelta(seconds=1)),
                _trip(passenger_id, None, "cancelled", "system", at + timedelta(seconds=2)),
                _trip(passenger_id, rider.id, "cancelled", "rider", at + timedelta(seconds=3)),
            ]
        )
        db.commit()
        rider_id = rider.id

    passenger_search = client.get(
        "/api/admin/accounts",
        headers=admin_h,
        params={"search": "account.stats@example.com", "role_filter": "user"},
    )
    assert passenger_search.status_code == 200, passenger_search.text
    passenger = passenger_search.json()["items"][0]
    assert passenger["id"] == passenger_id
    assert passenger["status"] == "active"
    assert passenger["stats"] == {
        "trips_total": 4,
        "trips_completed": 1,
        "trips_cancelled": 3,
        "account_cancellations": 1,
        "cancellation_rate": 0.25,
    }

    rider_search = client.get(
        "/api/admin/accounts",
        headers=admin_h,
        params={"search": "ACCOUNT-TEST-LICENSE", "role_filter": "rider", "status_filter": "pending"},
    )
    assert rider_search.status_code == 200, rider_search.text
    rider_account = rider_search.json()["items"][0]
    assert rider_account["rider_id"] == rider_id
    assert rider_account["stats"]["trips_total"] == 3
    assert rider_account["stats"]["account_cancellations"] == 1
    assert rider_account["stats"]["cancellation_rate"] == 1 / 3

    history = client.get(f"/api/admin/accounts/{passenger_id}/trips", headers=admin_h).json()
    assert history["total"] == 4
    assert history["items"][0]["cancelled_by"] == "rider"
    assert history["items"][0]["cancel_reason"] == "Test cancellation"

    assert client.post(f"/api/admin/accounts/{passenger_id}/suspend", headers=admin_h).json()["status"] == "suspended"
    assert client.post("/api/auth/login", json={"email": "account.stats@example.com", "password": "secret123"}).status_code == 403
    assert client.get(
        "/api/passenger/summary",
        headers={"Authorization": f"Bearer {passenger_token}"},
    ).status_code == 403
    suspended = client.get(
        "/api/admin/accounts",
        headers=admin_h,
        params={"search": passenger_id, "status_filter": "suspended"},
    ).json()
    assert suspended["items"][0]["account_status"] == "suspended"
    assert client.post(f"/api/admin/accounts/{passenger_id}/reactivate", headers=admin_h).json()["status"] == "active"
    assert client.post("/api/auth/login", json={"email": "account.stats@example.com", "password": "secret123"}).status_code == 200

    assert client.post(f"/api/admin/accounts/{rider_profile_id}/suspend", headers=admin_h).json()["status"] == "suspended"
    assert client.post("/api/auth/login", json={"email": "account.rider@example.com", "password": "secret123"}).status_code == 403
    reactivated = client.post(f"/api/admin/accounts/{rider_profile_id}/reactivate", headers=admin_h)
    assert reactivated.status_code == 200
    assert reactivated.json()["status"] == "pending"

    with SessionLocal() as db:
        db.execute(delete(Trip).where((Trip.user_id == passenger_id) | (Trip.rider_id == rider_id)))
        db.execute(delete(Vehicle).where(Vehicle.rider_id == rider_id))
        db.execute(delete(Rider).where(Rider.id == rider_id))
        db.execute(delete(Profile).where(Profile.id.in_((passenger_id, rider_profile_id))))
        db.commit()


def test_admin_accounts_includes_vehicle_change_and_block_filters(client, admin_h):
    passenger = client.post(
        "/api/auth/register",
        json={
            "full_name": "Block Filter Passenger",
            "email": "block.filter.user@example.com",
            "phone": "+8801700000021",
            "password": "secret123",
        },
    ).json()["profile"]
    rider_a_prof = client.post(
        "/api/auth/register",
        json={
            "full_name": "Vehicle Change Rider",
            "email": "vc.rider@example.com",
            "phone": "+8801700000022",
            "password": "secret123",
            "role": "rider",
            "license_no": "VC-FILTER-LIC-1",
            "vehicle_type": "bike",
            "plate_no": "DHAKA VC 11-1111",
            "vehicle_model": "Yamaha",
        },
    ).json()["profile"]
    rider_b_prof = client.post(
        "/api/auth/register",
        json={
            "full_name": "Blocked Rider",
            "email": "blocked.rider@example.com",
            "phone": "+8801700000023",
            "password": "secret123",
            "role": "rider",
            "license_no": "BLK-FILTER-LIC-2",
            "vehicle_type": "bike",
            "plate_no": "DHAKA BLK 22-2222",
            "vehicle_model": "Honda",
        },
    ).json()["profile"]

    with SessionLocal() as db:
        rider_a = db.scalar(select(Rider).where(Rider.profile_id == rider_a_prof["id"]))
        rider_b = db.scalar(select(Rider).where(Rider.profile_id == rider_b_prof["id"]))
        assert rider_a is not None and rider_b is not None
        rider_a_id, rider_b_id = rider_a.id, rider_b.id
        db.add(
            VehicleChange(
                rider_id=rider_a_id,
                vehicle_type="car",
                plate_no="DHAKA VC 99-9999",
                model="Toyota Corolla",
                status="pending",
            )
        )
        db.add(
            RiderPreference(
                user_id=passenger["id"],
                rider_id=rider_b_id,
                kind="blocked",
                reason="Test block",
            )
        )
        db.commit()

    try:
        vc_res = client.get(
            "/api/admin/accounts",
            headers=admin_h,
            params={"vehicle_change_only": "true", "search": "VC-FILTER-LIC-1"},
        )
        assert vc_res.status_code == 200
        vc_items = vc_res.json()["items"]
        assert len(vc_items) == 1
        assert vc_items[0]["rider_id"] == rider_a_id
        assert vc_items[0]["vehicle_change_pending"] is True
        assert vc_items[0]["blocked_by"] == 0

        blk_res = client.get(
            "/api/admin/accounts",
            headers=admin_h,
            params={"blocked_only": "true", "sort_by": "most-blocked"},
        )
        assert blk_res.status_code == 200
        blk_items = blk_res.json()["items"]
        assert any(item["rider_id"] == rider_b_id and item["blocked_by"] >= 1 for item in blk_items)
        assert all(item["blocked_by"] > 0 for item in blk_items)
    finally:
        with SessionLocal() as db:
            db.execute(delete(VehicleChange).where(VehicleChange.rider_id.in_((rider_a_id, rider_b_id))))
            db.execute(delete(RiderPreference).where(RiderPreference.rider_id.in_((rider_a_id, rider_b_id))))
            db.execute(delete(Vehicle).where(Vehicle.rider_id.in_((rider_a_id, rider_b_id))))
            db.execute(delete(Rider).where(Rider.id.in_((rider_a_id, rider_b_id))))
            db.execute(delete(Profile).where(Profile.id.in_((passenger["id"], rider_a_prof["id"], rider_b_prof["id"]))))
            db.commit()
