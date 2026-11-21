import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Profile, Rider, Vehicle, VehicleChange
from app.realtime import ADMINS, hub
from app.services.documents import placeholder_png


@pytest.fixture
def captured(monkeypatch):
    """Record what would be published, without needing open sockets."""
    events: list[tuple[list, dict]] = []
    original = hub.publish

    def spy(audience, message, coalesce=None, interval=2.0):
        events.append((list(audience), message))
        original(audience, message, coalesce=coalesce, interval=interval)

    monkeypatch.setattr(hub, "publish", spy)
    return events


def test_vehicle_change_submit_cancel_and_review_lifecycle(client, admin_h, captured):
    # Register a new rider to avoid interfering with other tests
    rider_reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "Change Rider",
            "email": "changerider@example.com",
            "phone": "+8801755555555",
            "password": "password123",
            "role": "rider",
            "license_no": "DK-VC-1",
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 12-3456",
            "vehicle_model": "Yamaha FZ",
        },
    ).json()
    rider_h = {"Authorization": f"Bearer {rider_reg['token']}"}

    with SessionLocal() as db:
        rider_prof = db.scalar(select(Profile).where(Profile.email == "changerider@example.com"))
        rider_obj = db.scalar(select(Rider).where(Rider.profile_id == rider_prof.id))
        rider_id = rider_obj.id
        rider_profile_id = rider_prof.id

    # 1. Submit vehicle change request
    captured.clear()
    submit_resp = client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 88-9999",
            "model": "Honda XBlade",
        },
    )
    assert submit_resp.status_code == 201, submit_resp.text
    change_data = submit_resp.json()
    assert change_data["status"] == "pending"
    assert change_data["model"] == "Honda XBlade"

    # Verify emit() to ADMINS with notify tuple converted to message["notify"]
    admin_events = [m for aud, m in captured if ADMINS in aud]
    assert len(admin_events) == 1
    assert admin_events[0]["type"] == "riders.changed"
    assert admin_events[0]["notify"]["title"] == "Vehicle change to review"
    assert "Change Rider" in admin_events[0]["notify"]["body"]

    # 2. Upload vehicle change documents
    png = placeholder_png("registration")
    captured.clear()
    up_resp = client.post(
        "/api/rider/vehicle-change/documents",
        headers=rider_h,
        data={"doc_type": "registration"},
        files={"file": ("registration.png", png, "image/png")},
    )
    assert up_resp.status_code == 200, up_resp.text
    # Partial upload (only 1 of 2 docs) emits riders.changed without notify
    assert any(ADMINS in aud and m["type"] == "riders.changed" for aud, m in captured)

    # Upload second document
    png_photo = placeholder_png("photo")
    captured.clear()
    up2_resp = client.post(
        "/api/rider/vehicle-change/documents",
        headers=rider_h,
        data={"doc_type": "vehicle_photo"},
        files={"file": ("vehicle_photo.png", png_photo, "image/png")},
    )
    assert up2_resp.status_code == 200, up2_resp.text
    assert up2_resp.json()["documents_complete"] is True
    complete_events = [m for aud, m in captured if ADMINS in aud]
    assert any(m["type"] == "riders.changed" and "notify" in m for m in complete_events)

    # 3. Reject vehicle change
    change_id = change_data["id"]
    captured.clear()
    reject_resp = client.post(
        f"/api/admin/vehicle-changes/{change_id}/review",
        headers=admin_h,
        json={"status": "rejected", "note": "Registration paper illegible"},
    )
    assert reject_resp.status_code == 200, reject_resp.text
    assert reject_resp.json()["status"] == "rejected"

    # Verify notify sent to rider and event sent to admins
    rider_events = [m for aud, m in captured if rider_profile_id in aud]
    assert len(rider_events) == 1
    assert rider_events[0]["type"] == "profile.updated"
    assert rider_events[0]["notify"]["title"] == "Vehicle change rejected"
    assert rider_events[0]["notify"]["body"] == "Registration paper illegible"
    assert any(ADMINS in aud and m["type"] == "riders.changed" for aud, m in captured)

    # 4. Submit a new change request
    captured.clear()
    submit2_resp = client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "car",
            "plate_no": "DHAKA METRO-GA 11-2233",
            "model": "Toyota Corolla",
        },
    )
    assert submit2_resp.status_code == 201, submit2_resp.text
    change2_id = submit2_resp.json()["id"]

    # 5. Admin approve vehicle change
    captured.clear()
    approve_resp = client.post(
        f"/api/admin/vehicle-changes/{change2_id}/review",
        headers=admin_h,
        json={"status": "approved", "note": "Verified"},
    )
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json()["status"] == "approved"

    # Verify notify sent to rider and event sent to admins
    rider_events = [m for aud, m in captured if rider_profile_id in aud]
    assert len(rider_events) == 1
    assert rider_events[0]["type"] == "profile.updated"
    assert rider_events[0]["notify"]["title"] == "New vehicle approved"
    assert "Toyota Corolla" in rider_events[0]["notify"]["body"]
    assert any(ADMINS in aud and m["type"] == "riders.changed" for aud, m in captured)

    # Verify rider now has active vehicle
    with SessionLocal() as db:
        active_vehicles = db.scalars(
            select(Vehicle).where(Vehicle.rider_id == rider_id, Vehicle.retired_at.is_(None))
        ).all()
        assert len(active_vehicles) == 1
        assert active_vehicles[0].plate_no == "DHAKA METRO GA-11-2233"
        assert active_vehicles[0].vehicle_type == "car"

    # 6. Test cancellation flow
    submit3_resp = client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "car",
            "plate_no": "DHAKA METRO-GA 44-5566",
            "model": "Toyota Axio",
        },
    )
    assert submit3_resp.status_code == 201
    captured.clear()
    cancel_resp = client.delete("/api/rider/vehicle-change", headers=rider_h)
    assert cancel_resp.status_code == 204
    assert any(ADMINS in aud and m["type"] == "riders.changed" for aud, m in captured)


def test_vehicle_change_websocket_live_push(client, admin_h):
    rider_reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "WS Rider",
            "email": "wsrider@example.com",
            "phone": "+8801766666666",
            "password": "password123",
            "role": "rider",
            "license_no": "DK-VC-2",
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 33-4455",
            "vehicle_model": "Yamaha R15",
        },
    ).json()
    rider_h = {"Authorization": f"Bearer {rider_reg['token']}"}
    rider_token = rider_reg["token"]
    admin_token = admin_h["Authorization"].split(" ", 1)[1]

    # Open admin and rider sockets
    with client.websocket_connect("/ws") as admin_ws, client.websocket_connect("/ws") as rider_ws:
        admin_ws.send_json({"type": "auth", "token": admin_token})
        assert admin_ws.receive_json()["type"] == "ready"
        rider_ws.send_json({"type": "auth", "token": rider_token})
        assert rider_ws.receive_json()["type"] == "ready"

        # Rider requests vehicle change
        submit_resp = client.post(
            "/api/rider/vehicle-change",
            headers=rider_h,
            json={
                "vehicle_type": "bike",
                "plate_no": "DHAKA METRO-HA 55-6677",
                "model": "Suzuki Gixxer",
            },
        )
        assert submit_resp.status_code == 201
        change_id = submit_resp.json()["id"]

        # Admin receives WebSocket notification
        admin_msg = admin_ws.receive_json()
        assert admin_msg["type"] == "riders.changed"
        assert admin_msg["notify"]["title"] == "Vehicle change to review"
        assert "WS Rider" in admin_msg["notify"]["body"]

        # Admin approves vehicle change
        approve_resp = client.post(
            f"/api/admin/vehicle-changes/{change_id}/review",
            headers=admin_h,
            json={"status": "approved", "note": "Looks good"},
        )
        assert approve_resp.status_code == 200

        # Rider receives WebSocket notification
        rider_msg = rider_ws.receive_json()
        assert rider_msg["type"] == "profile.updated"
        assert rider_msg["notify"]["title"] == "New vehicle approved"
        assert "Suzuki Gixxer" in rider_msg["notify"]["body"]

        # Admin receives riders.changed event
        admin_update = admin_ws.receive_json()
        assert admin_update["type"] == "riders.changed"

