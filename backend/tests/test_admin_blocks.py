from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete

from app.db import SessionLocal, utcnow
from app.models import Profile, RiderPreference
from app.schemas import iso_utc


def test_admin_can_list_rider_blocks_newest_first_and_empty_for_unblocked_rider(client, admin_h):
    riders = client.get("/api/admin/riders", headers=admin_h)
    assert riders.status_code == 200
    rider_id = riders.json()[0]["id"]

    empty = client.get(f"/api/admin/riders/{rider_id}/blocks", headers=admin_h)
    assert empty.status_code == 200
    assert empty.json() == []
    assert client.get("/api/admin/riders/not-a-rider/blocks", headers=admin_h).status_code == 404

    suffix = uuid4().hex
    passengers = [
        Profile(
            full_name="Amina Noor",
            phone=f"+880170{suffix[:7]}",
            email=f"amina-{suffix}@example.test",
            password_hash="unused",
            role="user",
        ),
        Profile(
            full_name="Farzana Islam",
            phone=f"+880171{suffix[7:14]}",
            email=f"farzana-{suffix}@example.test",
            password_hash="unused",
            role="user",
        ),
    ]
    newest_at = utcnow()
    oldest_at = newest_at - timedelta(days=2)
    with SessionLocal() as db:
        db.add_all(passengers)
        db.flush()
        preferences = [
            RiderPreference(
                user_id=passengers[0].id,
                rider_id=rider_id,
                kind="blocked",
                reason="Unsafe driving",
                created_at=oldest_at,
            ),
            RiderPreference(
                user_id=passengers[1].id,
                rider_id=rider_id,
                kind="blocked",
                reason="",
                created_at=newest_at,
            ),
        ]
        db.add_all(preferences)
        db.commit()
        passenger_ids = [passenger.id for passenger in passengers]

    try:
        response = client.get(f"/api/admin/riders/{rider_id}/blocks", headers=admin_h)
        assert response.status_code == 200, response.text
        blocks = response.json()
        assert [block["passenger_first_name"] for block in blocks] == ["Farzana", "Amina"]
        assert [block["reason"] for block in blocks] == [None, "Unsafe driving"]
        assert [block["date"] for block in blocks] == [iso_utc(newest_at), iso_utc(oldest_at)]
    finally:
        with SessionLocal() as db:
            db.execute(delete(RiderPreference).where(RiderPreference.user_id.in_(passenger_ids)))
            db.execute(delete(Profile).where(Profile.id.in_(passenger_ids)))
            db.commit()
