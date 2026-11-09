"""Text chat between a passenger and their rider while a trip is under way."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Trip, TripMessage
from app.realtime import emit
from app.schemas import iso_utc
from app.services.trips import TripError

# Chat is open from the moment a rider accepts until the trip ends.
OPEN_STATUSES = ("accepted", "ongoing")


def message_out(m: TripMessage, viewer_role: str) -> dict:
    return {
        "id": m.id,
        "sender_role": m.sender_role,
        "body": m.body,
        "created_at": iso_utc(m.created_at),
        "mine": m.sender_role == viewer_role,
    }


def list_for(db: Session, trip: Trip) -> list[TripMessage]:
    return list(db.scalars(select(TripMessage).where(TripMessage.trip_id == trip.id).order_by(TripMessage.created_at)))


def post(db: Session, trip: Trip, sender_role: str, sender_id: str, body: str) -> TripMessage:
    """`sender_role` is "user" (the passenger) or "rider"."""
    if trip.status not in OPEN_STATUSES:
        raise TripError(409, "Messages can only be sent while the trip is under way")
    text = body.strip()
    if not text:
        raise TripError(422, "Write a message first")
    message = TripMessage(trip_id=trip.id, sender_id=sender_id, sender_role=sender_role, body=text)
    db.add(message)
    db.flush()
    if sender_role == "user":
        recipient = trip.rider.profile_id if trip.rider else None
        title = f"Message from {trip.user.full_name.split()[0]}"
    else:
        recipient = trip.user_id
        title = "Message from your rider"
    emit(db, recipient, "trip.message", notify=(title, text if len(text) <= 100 else text[:97] + "..."), trip_id=trip.id)
    return message
