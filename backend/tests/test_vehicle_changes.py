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
            "otp": "000000",
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

    # Verify the rider so they can submit vehicle changes
    assert client.post(f"/api/admin/riders/{rider_id}/verify", headers=admin_h).status_code == 200

    # Upload an insurance document on the initial vehicle to verify carry-over on switch
    ins_png = placeholder_png("insurance")
    ins_resp = client.post(
        "/api/rider/documents",
        headers=rider_h,
        data={"doc_type": "insurance"},
        files={"file": ("insurance.png", ins_png, "image/png")},
    )
    assert ins_resp.status_code == 201, ins_resp.text
    ins_doc_id = ins_resp.json()["id"]

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

    # 4. Submit a new change request with color and registration_no
    captured.clear()
    submit2_resp = client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "car",
            "plate_no": "DHAKA METRO-GA 11-2233",
            "model": "Toyota Corolla",
            "color": "Pearl White",
            "registration_no": "reg-2026-9988",
        },
    )
    assert submit2_resp.status_code == 201, submit2_resp.text
    change2_id = submit2_resp.json()["id"]
    assert submit2_resp.json()["color"] == "Pearl White"
    assert submit2_resp.json()["registration_no"] == "REG-2026-9988"

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

    # Verify rider now has active vehicle with preserved color & registration_no
    with SessionLocal() as db:
        active_vehicles = db.scalars(
            select(Vehicle).where(Vehicle.rider_id == rider_id, Vehicle.retired_at.is_(None))
        ).all()
        assert len(active_vehicles) == 1
        assert active_vehicles[0].plate_no == "DHAKA METRO GA-11-2233"
        assert active_vehicles[0].vehicle_type == "car"
        assert active_vehicles[0].color == "Pearl White"
        assert active_vehicles[0].registration_no == "REG-2026-9988"

    # Verify prior insurance document is carried over and still accessible
    docs_resp = client.get("/api/rider/documents", headers=rider_h)
    assert docs_resp.status_code == 200
    ins_entry = next(d for d in docs_resp.json()["required"] if d["doc_type"] == "insurance")
    assert ins_entry["document"] is not None
    assert ins_entry["document"]["id"] == ins_doc_id
    assert client.get(f"/api/documents/{ins_doc_id}/file", headers=rider_h).status_code == 200

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
            "otp": "000000",
            "license_no": "DK-VC-2",
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 33-4455",
            "vehicle_model": "Yamaha R15",
        },
    ).json()
    rider_h = {"Authorization": f"Bearer {rider_reg['token']}"}
    rider_token = rider_reg["token"]
    admin_token = admin_h["Authorization"].split(" ", 1)[1]

    with SessionLocal() as db:
        ws_prof = db.scalar(select(Profile).where(Profile.email == "wsrider@example.com"))
        ws_rider = db.scalar(select(Rider).where(Rider.profile_id == ws_prof.id))
        ws_rider_id = ws_rider.id
    assert client.post(f"/api/admin/riders/{ws_rider_id}/verify", headers=admin_h).status_code == 200

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


def test_vehicle_change_document_upload_limits_and_validation(client, admin_h, monkeypatch):
    from app.config import settings

    rider_reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "Doc Limit Rider",
            "email": "doclimit@example.com",
            "phone": "+8801777777777",
            "password": "password123",
            "role": "rider",
            "otp": "000000",
            "license_no": "DK-VC-3",
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 77-8899",
            "vehicle_model": "Bajaj Pulsar",
        },
    ).json()
    rider_h = {"Authorization": f"Bearer {rider_reg['token']}"}

    with SessionLocal() as db:
        dl_prof = db.scalar(select(Profile).where(Profile.email == "doclimit@example.com"))
        dl_rider = db.scalar(select(Rider).where(Rider.profile_id == dl_prof.id))
        dl_rider_id = dl_rider.id
    assert client.post(f"/api/admin/riders/{dl_rider_id}/verify", headers=admin_h).status_code == 200

    submit_resp = client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 99-0011",
            "model": "TVS Apache",
        },
    )
    assert submit_resp.status_code == 201, submit_resp.text

    # Oversized upload returns 413 without persisting
    monkeypatch.setattr(settings, "max_upload_mb", 0.001)  # ~1048 bytes
    oversized = b"\x89PNG\r\n\x1a\n" + b"0" * 2048
    over_resp = client.post(
        "/api/rider/vehicle-change/documents",
        headers=rider_h,
        data={"doc_type": "registration"},
        files={"file": ("big.png", oversized, "image/png")},
    )
    assert over_resp.status_code == 413, over_resp.text
    assert "under" in over_resp.json()["detail"].lower()

    # Restore limit for content-type & magic-byte validation
    monkeypatch.setattr(settings, "max_upload_mb", 5.0)

    bad_type = client.post(
        "/api/rider/vehicle-change/documents",
        headers=rider_h,
        data={"doc_type": "registration"},
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert bad_type.status_code == 422, bad_type.text

    bad_magic = client.post(
        "/api/rider/vehicle-change/documents",
        headers=rider_h,
        data={"doc_type": "registration"},
        files={"file": ("fake.png", b"not-a-png", "image/png")},
    )
    assert bad_magic.status_code == 422, bad_magic.text

    # Valid upload succeeds and persists file
    png = placeholder_png("registration")
    ok_resp = client.post(
        "/api/rider/vehicle-change/documents",
        headers=rider_h,
        data={"doc_type": "registration"},
        files={"file": ("registration.png", png, "image/png")},
    )
    assert ok_resp.status_code == 200, ok_resp.text
    reg_entry = next(d for d in ok_resp.json()["documents"] if d["doc_type"] == "registration")
    reg_doc = reg_entry["document"]
    assert reg_doc is not None
    assert reg_doc["original_name"] == "registration.png"
    assert reg_doc["content_type"] == "image/png"
    assert reg_doc["size_bytes"] == len(png)

    file_resp = client.get(f"/api/documents/{reg_doc['id']}/file", headers=rider_h)
    assert file_resp.status_code == 200
    assert file_resp.content == png


def test_vehicle_change_rejects_unverified_and_suspended_riders(client, admin_h):
    rider_reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "Unverified Rider",
            "email": "unverifiedvc@example.com",
            "phone": "+8801788888881",
            "password": "password123",
            "role": "rider",
            "otp": "000000",
            "license_no": "DK-VC-4",
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 21-2121",
            "vehicle_model": "Hero Splendor",
        },
    ).json()
    rider_h = {"Authorization": f"Bearer {rider_reg['token']}"}

    # Unverified (pending) rider cannot submit a vehicle change
    resp = client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 22-2222",
            "model": "Honda CB",
        },
    )
    assert resp.status_code == 403

    # Verify, then suspend rider
    with SessionLocal() as db:
        prof = db.scalar(select(Profile).where(Profile.email == "unverifiedvc@example.com"))
        r = db.scalar(select(Rider).where(Rider.profile_id == prof.id))
        rider_id = r.id
    assert client.post(f"/api/admin/riders/{rider_id}/verify", headers=admin_h).status_code == 200
    assert client.post(f"/api/admin/riders/{rider_id}/suspend", headers=admin_h).status_code == 200

    resp_suspended = client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 22-2222",
            "model": "Honda CB",
        },
    )
    assert resp_suspended.status_code == 403


def test_vehicle_change_rejects_approval_during_active_trip(client, admin_h):
    from app.models import Trip

    rider_reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "Busy Rider",
            "email": "busyridervc@example.com",
            "phone": "+8801788888882",
            "password": "password123",
            "role": "rider",
            "otp": "000000",
            "license_no": "DK-VC-5",
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 31-3131",
            "vehicle_model": "Yamaha FZ",
        },
    ).json()
    rider_h = {"Authorization": f"Bearer {rider_reg['token']}"}

    passenger_reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "Trip Passenger",
            "email": "trippassvc@example.com",
            "phone": "+8801788888883",
            "password": "password123",
            "role": "user",
            "otp": "000000",
        },
    ).json()

    with SessionLocal() as db:
        r_prof = db.scalar(select(Profile).where(Profile.email == "busyridervc@example.com"))
        r = db.scalar(select(Rider).where(Rider.profile_id == r_prof.id))
        rider_id = r.id
        vehicle_id = r.vehicle.id
        p_prof = db.scalar(select(Profile).where(Profile.email == "trippassvc@example.com"))
        passenger_id = p_prof.id

    assert client.post(f"/api/admin/riders/{rider_id}/verify", headers=admin_h).status_code == 200

    submit_resp = client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 32-3232",
            "model": "Suzuki Gixxer",
        },
    )
    assert submit_resp.status_code == 201
    change_id = submit_resp.json()["id"]

    # Create an active (ongoing) trip for this rider
    with SessionLocal() as db:
        trip = Trip(
            user_id=passenger_id,
            rider_id=rider_id,
            vehicle_id=vehicle_id,
            vehicle_type_requested="bike",
            pickup_address="A",
            pickup_lat=23.78,
            pickup_lng=90.40,
            drop_address="B",
            drop_lat=23.79,
            drop_lng=90.41,
            distance_km=2.0,
            predicted_eta_min=10.0,
            fare_estimate=100.0,
            status="ongoing",
        )
        db.add(trip)
        db.commit()
        trip_id = trip.id

    approve_resp = client.post(
        f"/api/admin/vehicle-changes/{change_id}/review",
        headers=admin_h,
        json={"status": "approved", "note": "Should fail"},
    )
    assert approve_resp.status_code == 409

    # Once trip completes, approval succeeds
    with SessionLocal() as db:
        t = db.get(Trip, trip_id)
        t.status = "completed"
        db.commit()

    approve_ok = client.post(
        f"/api/admin/vehicle-changes/{change_id}/review",
        headers=admin_h,
        json={"status": "approved", "note": "Now ok"},
    )
    assert approve_ok.status_code == 200


def test_vehicle_change_preserves_files_when_commit_fails(client, admin_h, monkeypatch):
    from sqlalchemy.orm import Session as SASession
    from app.models import RiderDocument
    from app.services import documents as docs

    rider_reg = client.post(
        "/api/auth/register",
        json={
            "full_name": "Commit Fail Rider",
            "email": "commitfailvc@example.com",
            "phone": "+8801788888884",
            "password": "password123",
            "role": "rider",
            "otp": "000000",
            "license_no": "DK-VC-6",
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 41-4141",
            "vehicle_model": "Bajaj Discover",
        },
    ).json()
    rider_h = {"Authorization": f"Bearer {rider_reg['token']}"}

    with SessionLocal() as db:
        prof = db.scalar(select(Profile).where(Profile.email == "commitfailvc@example.com"))
        r = db.scalar(select(Rider).where(Rider.profile_id == prof.id))
        rider_id = r.id
    assert client.post(f"/api/admin/riders/{rider_id}/verify", headers=admin_h).status_code == 200

    assert client.post(
        "/api/rider/vehicle-change",
        headers=rider_h,
        json={
            "vehicle_type": "bike",
            "plate_no": "DHAKA METRO-HA 42-4242",
            "model": "TVS Metro",
        },
    ).status_code == 201

    png1 = placeholder_png("reg1")
    up1 = client.post(
        "/api/rider/vehicle-change/documents",
        headers=rider_h,
        data={"doc_type": "registration"},
        files={"file": ("reg1.png", png1, "image/png")},
    )
    assert up1.status_code == 200
    doc1_id = next(d for d in up1.json()["documents"] if d["doc_type"] == "registration")["document"]["id"]
    with SessionLocal() as db:
        doc1_path = docs.path_for(db.get(RiderDocument, doc1_id))
    assert doc1_path.exists()

    # Simulate DB commit failure on replacement upload
    def boom(self):
        raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(SASession, "commit", boom)
    png2 = placeholder_png("reg2")
    with pytest.raises(RuntimeError, match="simulated commit failure"):
        client.post(
            "/api/rider/vehicle-change/documents",
            headers=rider_h,
            data={"doc_type": "registration"},
            files={"file": ("reg2.png", png2, "image/png")},
        )

    # Original file must still exist on disk because commit failed
    assert doc1_path.exists()


