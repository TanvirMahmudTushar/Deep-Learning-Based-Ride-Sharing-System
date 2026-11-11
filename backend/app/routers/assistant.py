"""Passenger assistant (Groq gpt-oss-20b) with a rule-based fallback."""

import json
import re

from fastapi import APIRouter

from app.models import Zone
from app.geo import haversine_km
from app.schemas import BookingSuggestion, ChatIn, ChatOut, LatLng, live_eta_min
from app.security import DB, Passenger
from app.services import cancel_fees
from app.services import trips as trip_service
from app.services.groq_client import assistant_reply
from app.services.zones import all_zones

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

BOOKING_RE = re.compile(r"BOOKING:\s*(\{.*?\})", re.DOTALL)
VEHICLE_WORDS = {"bike": "bike", "motorbike": "bike", "motorcycle": "bike", "cng": "cng", "auto": "cng", "rickshaw": "cng", "car": "car", "taxi": "car"}


def _context(db: DB, user: Passenger, zones: list[Zone]) -> str:
    lines = ["Known zones: " + ", ".join(z.name for z in zones)]
    trip = trip_service.active_trip_for_user(db, user.id)
    if trip is None:
        lines.append("The passenger has no active trip.")
    else:
        lines.append(
            f"Active trip: status={trip.status}, vehicle={trip.vehicle_type_requested}, from '{trip.pickup_address}' "
            f"to '{trip.drop_address}', distance={trip.distance_km} km, fare={float(trip.fare_estimate):.0f} BDT "
            f"(multiplier {trip.price_multiplier}x; reason: {trip.price_reason}), trip ETA={trip.predicted_eta_min} min, "
            f"pickup ETA={trip.pickup_eta_min} min."
        )
        if trip.vehicle:
            lines.append(f"Assigned vehicle: {trip.vehicle.model}, plate {trip.vehicle.plate_no}.")
        lines.extend(_live_lines(trip))
    owed = cancel_fees.outstanding(db, user.id)
    if owed > 0:
        lines.append(f"The passenger owes {owed:.0f} BDT in late-cancellation fees, which will be added to their next ride.")
    lines.append(
        f"Cancellation policy: free until {cancel_fees.settings.late_cancel_grace_seconds // 60} minutes after a rider accepts; "
        "after that a fee (bike 20, CNG 30, car 50 BDT by default) is added to the next ride. Admins can waive it."
    )
    lines.append("Vehicle types: bike (fastest, 1 passenger), cng (3-wheeler, up to 3), car (AC, up to 4).")
    return "\n".join(lines)


def _live_lines(trip) -> list[str]:
    """Where the rider is now, for "where is my rider" and "how long" questions."""
    rider = trip.rider
    if rider is None or rider.current_lat is None or trip.status not in ("accepted", "ongoing"):
        return []
    eta = live_eta_min(trip)
    if trip.status == "accepted" and trip.arrived_at:
        return ["The rider has arrived at the pickup point."]
    target, label = ((trip.pickup_lat, trip.pickup_lng), "pickup") if trip.status == "accepted" else ((trip.drop_lat, trip.drop_lng), "destination")
    km = haversine_km((rider.current_lat, rider.current_lng), target)
    return [f"Right now the rider is {km:.1f} km (straight line) from the {label}, about {eta:.0f} min away."] if eta is not None else []


def _zone_by_name(zones: list[Zone], name: str) -> Zone | None:
    name = name.strip().lower()
    return next((z for z in zones if z.name.lower() == name), None)


def _suggestion(zones: list[Zone], pickup: str, drop: str, vehicle_type: str) -> BookingSuggestion | None:
    p, d = _zone_by_name(zones, pickup), _zone_by_name(zones, drop)
    if not p or not d or p.id == d.id or vehicle_type not in ("bike", "cng", "car"):
        return None
    return BookingSuggestion(
        pickup_zone=p.name,
        drop_zone=d.name,
        vehicle_type=vehicle_type,
        pickup=LatLng(lat=p.center_lat, lng=p.center_lng),
        drop=LatLng(lat=d.center_lat, lng=d.center_lng),
    )


def _fallback(text: str, zones: list[Zone], live: list[str] | None = None) -> tuple[str, BookingSuggestion | None]:
    lower = text.lower()
    if live is not None and re.search(r"\b(where|how long|how far|eta|arriv|minutes?|close)\b", lower):
        return (" ".join(live) if live else "You don't have a rider on the way right now. Book a ride and I can track it for you."), None
    if re.search(r"\bcancel", lower):
        return (
            f"Cancelling is free until {cancel_fees.settings.late_cancel_grace_seconds // 60} minutes after a rider accepts. "
            "After that, a small fee for the vehicle type is added to your next ride.",
            None,
        )
    found = sorted(((lower.find(z.name.lower()), z) for z in zones if z.name.lower() in lower), key=lambda x: x[0])
    vehicle = next((vt for word, vt in VEHICLE_WORDS.items() if re.search(rf"\b{word}\b", lower)), "bike")
    if len(found) >= 2:
        s = _suggestion(zones, found[0][1].name, found[1][1].name, vehicle)
        if s:
            return f"I can set up a {vehicle} ride from {s.pickup_zone} to {s.drop_zone}. Check the fare and confirm on the booking panel.", s
    if "fare" in lower or "price" in lower or "expensive" in lower:
        return "Fares are base + distance + time, multiplied by a demand factor when many requests are expected and few riders are nearby. The reason is shown under each fare.", None
    return (
        "I can help you book a ride or explain your trip. Try: \"bike from Gulshan to Dhanmondi\". "
        "Known areas: " + ", ".join(z.name for z in zones) + ".",
        None,
    )


@router.post("/chat", response_model=ChatOut)
def chat(body: ChatIn, db: DB, user: Passenger):
    zones = all_zones(db)
    messages = [m.model_dump() for m in body.messages]
    reply = assistant_reply(messages, _context(db, user, zones))
    if reply is None:
        trip = trip_service.active_trip_for_user(db, user.id)
        text, booking = _fallback(body.messages[-1].content, zones, _live_lines(trip) if trip else [])
        return ChatOut(reply=text, booking=booking, source="fallback")

    booking = None
    match = BOOKING_RE.search(reply)
    if match:
        try:
            data = json.loads(match.group(1))
            booking = _suggestion(zones, data.get("pickup_zone", ""), data.get("drop_zone", ""), data.get("vehicle_type", ""))
        except (json.JSONDecodeError, AttributeError):
            booking = None
        reply = BOOKING_RE.sub("", reply).strip()
    return ChatOut(reply=reply, booking=booking, source="groq")
