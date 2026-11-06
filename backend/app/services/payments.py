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
from app.models import Payment, PricingRule, Settlement, Trip


def commission_pct_for(db: Session, vehicle_type: str) -> float:
    pct = db.scalar(select(PricingRule.commission_pct).where(PricingRule.vehicle_type == vehicle_type))
    return float(pct) if pct is not None else settings.default_commission_pct


def create_for_trip(db: Session, trip: Trip) -> Payment:
    amount = float(trip.fare_final if trip.fare_final is not None else trip.fare_estimate)
    pct = commission_pct_for(db, trip.vehicle_type_requested)
    commission = round(amount * pct / 100)
    payment = Payment(
        trip_id=trip.id,
        rider_id=trip.rider_id,
        method="cash",
        amount=amount,
        commission_pct=pct,
        commission=commission,
        rider_earning=amount - commission,
    )
    db.add(payment)
    db.flush()
    return payment


def mark_collected(payment: Payment) -> Payment:
    if payment.status != "collected":
        payment.status = "collected"
        payment.collected_at = utcnow()
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
