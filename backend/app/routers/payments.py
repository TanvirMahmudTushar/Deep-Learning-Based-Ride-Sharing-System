"""Cash collection (rider), earnings (rider), revenue and settlements (admin)."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.db import local_day_start, local_month_start, utcnow
from app.models import Payment, Rider, Settlement, Trip
from app.realtime import ADMINS, emit
from app.schemas import TripOut, iso_utc, trip_out
from app.security import DB, Admin, CurrentRider
from app.services import payments

router = APIRouter(prefix="/api", tags=["payments"])


class SettlementIn(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)
    note: str = Field(default="", max_length=200)


def _payment_row(p: Payment) -> dict:
    t = p.trip
    return {
        "id": p.id,
        "trip_id": p.trip_id,
        "amount": p.amount,
        "commission": p.commission,
        "commission_pct": p.commission_pct,
        "rider_earning": p.rider_earning,
        "status": p.status,
        "method": p.method,
        "created_at": iso_utc(p.created_at),
        "collected_at": iso_utc(p.collected_at),
        "pickup_address": t.pickup_address,
        "drop_address": t.drop_address,
        "vehicle_type": t.vehicle_type_requested,
        "distance_km": t.distance_km,
    }


def _period(db: DB, rider_id: str, since) -> dict:
    gross, earning, trips = db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0), func.coalesce(func.sum(Payment.rider_earning), 0), func.count(Payment.id)).where(
            Payment.rider_id == rider_id, Payment.status != "disputed", Payment.created_at >= since
        )
    ).one()
    return {"gross": round(float(gross)), "earnings": round(float(earning)), "trips": int(trips)}


@router.post("/rider/trips/{trip_id}/collect", response_model=TripOut)
def collect_cash(trip_id: str, db: DB, rider: CurrentRider):
    trip = db.get(Trip, trip_id)
    if trip is None or trip.rider_id != rider.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    if trip.payment is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Complete the trip before collecting payment")
    payments.mark_collected(trip.payment)
    emit(db, trip.user_id, "trip.updated", trip_id=trip.id, status=trip.status, notify=("Payment received", f"Thanks! ৳{trip.payment.amount:.0f} paid in cash."))
    emit(db, ADMINS, "payments.changed")
    db.commit()
    return trip_out(db, trip, for_rider=True)


@router.get("/rider/pending-payment", response_model=TripOut | None)
def pending_payment(db: DB, rider: CurrentRider):
    """The latest completed trip whose cash the rider has not confirmed yet (survives page reloads)."""
    trip = db.scalar(
        select(Trip)
        .join(Payment, Payment.trip_id == Trip.id)
        .where(Trip.rider_id == rider.id, Payment.status == "pending", Trip.completed_at >= utcnow() - timedelta(hours=12))
        .order_by(Trip.completed_at.desc())
    )
    return trip_out(db, trip, for_rider=True) if trip else None


@router.get("/rider/earnings")
def rider_earnings(db: DB, rider: CurrentRider):
    now = utcnow()
    recent = db.scalars(
        select(Payment).where(Payment.rider_id == rider.id).options(selectinload(Payment.trip)).order_by(Payment.created_at.desc()).limit(50)
    ).all()
    settlements = db.scalars(select(Settlement).where(Settlement.rider_id == rider.id).order_by(Settlement.created_at.desc()).limit(20)).all()
    return {
        "balance": payments.rider_balance(db, rider.id),
        "today": _period(db, rider.id, local_day_start()),
        "week": _period(db, rider.id, now - timedelta(days=7)),
        "month": _period(db, rider.id, local_month_start()),
        "payments": [_payment_row(p) for p in recent],
        "settlements": [{"id": s.id, "amount": s.amount, "note": s.note, "created_at": iso_utc(s.created_at)} for s in settlements],
    }


@router.get("/admin/payments")
def payments_overview(db: DB, admin: Admin):
    now = utcnow()

    def totals(since) -> dict:
        gross, commission, n = db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0), func.coalesce(func.sum(Payment.commission), 0), func.count(Payment.id)).where(
                Payment.status == "collected", Payment.created_at >= since
            )
        ).one()
        return {"gross": round(float(gross)), "commission": round(float(commission)), "trips": int(n)}

    riders = db.scalars(select(Rider).where(Rider.id.in_(select(Payment.rider_id).distinct())).options(selectinload(Rider.profile), selectinload(Rider.vehicles))).all()
    balances = []
    for r in riders:
        b = payments.rider_balance(db, r.id)
        balances.append(
            {
                "rider_id": r.id,
                "full_name": r.profile.full_name,
                "phone": r.profile.phone,
                "is_simulated": r.is_simulated,
                "vehicle_type": r.vehicle.vehicle_type if r.vehicle else None,
                **b,
            }
        )
    balances.sort(key=lambda b: (b["is_simulated"], -b["commission_due"]))

    pending = db.scalars(
        select(Payment).where(Payment.status.in_(("pending", "disputed"))).options(selectinload(Payment.trip)).order_by(Payment.created_at.desc()).limit(50)
    ).all()
    settlements = db.execute(
        select(Settlement, Rider).join(Rider, Rider.id == Settlement.rider_id).options(selectinload(Rider.profile)).order_by(Settlement.created_at.desc()).limit(20)
    ).all()
    return {
        "today": totals(local_day_start()),
        "week": totals(now - timedelta(days=7)),
        "month": totals(local_month_start()),
        "commission_outstanding": sum(max(0, b["commission_due"]) for b in balances),
        "balances": balances,
        "open_payments": [_payment_row(p) for p in pending],
        "settlements": [
            {"id": s.id, "rider_name": r.profile.full_name, "amount": s.amount, "note": s.note, "created_at": iso_utc(s.created_at)} for s, r in settlements
        ],
    }


@router.post("/admin/riders/{rider_id}/settlements", status_code=status.HTTP_201_CREATED)
def record_settlement(rider_id: str, body: SettlementIn, db: DB, admin: Admin):
    rider = db.get(Rider, rider_id)
    if rider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider not found")
    s = Settlement(rider_id=rider.id, amount=round(body.amount, 2), note=body.note.strip(), recorded_by=admin.id)
    db.add(s)
    emit(db, rider.profile_id, "earnings.updated", notify=("Settlement recorded", f"৳{s.amount:.0f} commission payment received. Thank you!"))
    emit(db, ADMINS, "payments.changed")
    db.commit()
    return {"ok": True, "balance": payments.rider_balance(db, rider.id)}


@router.post("/admin/payments/{payment_id}/resolve")
def resolve_payment(payment_id: str, db: DB, admin: Admin):
    """Mark a pending or disputed payment as collected after checking with rider and passenger."""
    p = db.get(Payment, payment_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    payments.mark_collected(p)
    emit(db, ADMINS, "payments.changed")
    db.commit()
    return _payment_row(p)
