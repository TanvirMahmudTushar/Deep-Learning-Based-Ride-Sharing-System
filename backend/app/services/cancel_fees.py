"""Late-cancellation fees, carried onto the passenger's next ride.

Cancelling is free for `late_cancel_grace_seconds` after a rider accepts. After that, the passenger
owes a fee for that vehicle type (set by admins on the pricing rules). Cholo is cash only, so the fee
is added to the passenger's next completed ride and kept by the platform, through the rider's
commission. An admin can waive a fee: one still owed is dropped, and one already paid becomes a
credit taken off the next ride.

Fee status on the cancelled trip: owed -> paid, or owed -> waived; paid -> credited -> credit_used.
While a later ride is in progress, `fee_settled_by` on the cancelled trip points at that ride.
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.models import PricingRule, Trip

# Used until an admin sets a fee on the pricing rules.
DEFAULT_CANCEL_FEE = {"bike": 20.0, "cng": 30.0, "car": 50.0}


def fee_for(db: Session, vehicle_type: str) -> float:
    fee = db.scalar(select(PricingRule.cancel_fee).where(PricingRule.vehicle_type == vehicle_type))
    return float(fee) if fee is not None else DEFAULT_CANCEL_FEE.get(vehicle_type, 0.0)


def free_cancel_until(trip: Trip) -> datetime | None:
    """When free cancellation ends, for a trip a rider has accepted."""
    if trip.status != "accepted" or trip.accepted_at is None:
        return None
    return trip.accepted_at + timedelta(seconds=settings.late_cancel_grace_seconds)


def fee_if_cancelled_now(db: Session, trip: Trip, now: datetime | None = None) -> float:
    until = free_cancel_until(trip)
    if until is None or (now or utcnow()) < until:
        return 0.0
    return fee_for(db, trip.vehicle_type_requested)


def charge(db: Session, trip: Trip) -> float:
    """Call before a passenger's cancellation changes the trip's status. Returns the fee, or 0."""
    fee = fee_if_cancelled_now(db, trip)
    if fee > 0:
        trip.cancel_fee = fee
        trip.cancel_fee_status = "owed"
    return fee


def _unsettled(db: Session, user_id: str) -> list[Trip]:
    return list(
        db.scalars(
            select(Trip).where(
                Trip.user_id == user_id,
                Trip.cancel_fee_status.in_(("owed", "credited")),
                Trip.fee_settled_by.is_(None),
            )
        )
    )


def _net(trips: list[Trip]) -> float:
    return round(sum((t.cancel_fee or 0) * (1 if t.cancel_fee_status == "owed" else -1) for t in trips), 2)


def outstanding(db: Session, user_id: str) -> float:
    """Fees owed minus credits, not yet added to a ride. Positive means the passenger owes money."""
    return _net(_unsettled(db, user_id))


def reserve_for(db: Session, trip: Trip) -> None:
    """Add outstanding fees and credits to a newly booked ride."""
    items = _unsettled(db, trip.user_id)
    if not items:
        return
    # A credit can lower a ride's price to zero, never below.
    trip.fee_adjustment = max(_net(items), -float(trip.fare_estimate))
    for t in items:
        t.fee_settled_by = trip.id


def release(db: Session, trip: Trip) -> None:
    """The ride carrying fees was cancelled, so they wait for the next one."""
    for t in db.scalars(select(Trip).where(Trip.fee_settled_by == trip.id)):
        t.fee_settled_by = None
    trip.fee_adjustment = None


def settle(db: Session, trip: Trip) -> None:
    """The ride carrying fees was completed and paid."""
    for t in db.scalars(select(Trip).where(Trip.fee_settled_by == trip.id)):
        t.cancel_fee_status = "paid" if t.cancel_fee_status == "owed" else "credit_used"


def waive(db: Session, trip: Trip) -> str:
    """Admin goodwill. Returns the new status; raises ValueError when there is nothing to waive."""
    if trip.cancel_fee_status == "owed":
        if trip.fee_settled_by:
            # Already added to a ride in progress: take it back off that ride.
            carrying = db.get(Trip, trip.fee_settled_by)
            if carrying is not None and carrying.fee_adjustment is not None:
                carrying.fee_adjustment = round(carrying.fee_adjustment - (trip.cancel_fee or 0), 2) or None
            trip.fee_settled_by = None
        trip.cancel_fee_status = "waived"
    elif trip.cancel_fee_status == "paid":
        trip.cancel_fee_status = "credited"
        trip.fee_settled_by = None
    else:
        raise ValueError("This trip has no fee to waive")
    return trip.cancel_fee_status
