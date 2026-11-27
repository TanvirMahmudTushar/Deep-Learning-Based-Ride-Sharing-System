"""Cash payments, platform commission and rider settlements.

The passenger pays the rider in cash at drop-off. Each completed trip gets a Payment that starts
as "pending" and becomes "collected" when the rider confirms the cash. Because the rider holds
the cash, the platform's commission is a balance the rider owes; admins record Settlements when
the rider pays it over.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.models import Payment, PricingRule, SafetyAlert, Settlement, Trip


def commission_pct_for(db: Session, vehicle_type: str) -> float:
    pct = db.scalar(select(PricingRule.commission_pct).where(PricingRule.vehicle_type == vehicle_type))
    return float(pct) if pct is not None else settings.default_commission_pct


def create_for_trip(db: Session, trip: Trip) -> Payment:
    fare = float(trip.fare_final if trip.fare_final is not None else trip.fare_estimate)
    pct = commission_pct_for(db, trip.vehicle_type_requested)
    fare_commission = round(fare * pct / 100)
    # Earlier late-cancellation fees (or credits) ride along in the cash. The platform keeps the fees
    # and absorbs the credits, so they change the commission, never the rider's earning.
    adjustment = float(trip.fee_adjustment or 0)
    payment = Payment(
        trip_id=trip.id,
        rider_id=trip.rider_id,
        method="cash",
        amount=fare + adjustment,
        commission_pct=pct,
        commission=fare_commission + adjustment,
        rider_earning=fare - fare_commission,
    )
    db.add(payment)
    db.flush()
    return payment


def mark_collected(payment: Payment) -> Payment:
    if payment.status != "collected":
        payment.status = "collected"
        payment.collected_at = utcnow()
    return payment


def resolve_payment(
    db: Session,
    payment: Payment,
    *,
    admin_id: str,
    action: str,
    note: str = "",
    adjusted_amount: float | None = None,
) -> Payment:
    """Resolve an open (pending or disputed) payment with audit tracking."""
    if payment.status not in ("pending", "disputed"):
        raise ValueError(f"Payment is already {payment.status}")

    cleaned_note = note.strip()
    now = utcnow()

    if action == "mark_settled":
        mark_collected(payment)
    elif action == "waive_balance":
        if not cleaned_note:
            raise ValueError("An audit note is required when waiving a balance")
        if payment.original_amount is None:
            payment.original_amount = payment.amount
        payment.status = "waived"
        payment.commission = 0.0
        payment.rider_earning = 0.0
    elif action == "resolve_dispute":
        if not cleaned_note:
            raise ValueError("An audit note is required when resolving a dispute")
        mark_collected(payment)
        open_fare_alerts = db.scalars(
            select(SafetyAlert).where(
                SafetyAlert.trip_id == payment.trip_id,
                SafetyAlert.alert_type == "report",
                SafetyAlert.status != "closed",
            )
        ).all()
        for alert in open_fare_alerts:
            if alert.details.get("category") == "fare":
                alert.status = "closed"
                alert.reviewed_by = admin_id
                alert.resolution_note = cleaned_note
    elif action == "apply_adjustment":
        if adjusted_amount is None:
            raise ValueError("adjusted_amount is required when applying an adjustment")
        if not cleaned_note:
            raise ValueError("An audit note is required when adjusting a fare")
        if payment.original_amount is None:
            payment.original_amount = payment.amount
        new_amount = round(float(adjusted_amount), 2)
        new_commission = round(new_amount * float(payment.commission_pct) / 100)
        payment.amount = new_amount
        payment.commission = float(new_commission)
        payment.rider_earning = round(new_amount - float(new_commission), 2)
        mark_collected(payment)
    else:
        raise ValueError(f"Unknown resolution action: {action}")

    payment.resolved_by = admin_id
    payment.resolved_at = now
    payment.resolution_action = action
    payment.resolution_note = cleaned_note or None
    return payment


def rider_balance(db: Session, rider_id: str) -> dict:
    collected = db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0), func.coalesce(func.sum(Payment.commission), 0), func.count(Payment.id)).where(
            Payment.rider_id == rider_id, Payment.status == "collected"
        )
    ).one()
    pending = db.scalar(select(func.count(Payment.id)).where(Payment.rider_id == rider_id, Payment.status == "pending")) or 0
    settled = db.scalar(select(func.coalesce(func.sum(Settlement.amount), 0)).where(Settlement.rider_id == rider_id)) or 0
    gross, commission, trips = float(collected[0]), float(collected[1]), int(collected[2])
    return {
        "gross_collected": round(gross),
        "commission_total": round(commission),
        "rider_earnings": round(gross - commission),
        "settled": round(float(settled)),
        "commission_due": round(commission - float(settled)),
        "collected_trips": trips,
        "pending_confirmations": pending,
    }
