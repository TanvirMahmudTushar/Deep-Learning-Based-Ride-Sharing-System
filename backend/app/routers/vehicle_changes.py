"""Vehicle changes: a rider asks to switch vehicles, uploads the new vehicle's papers, and an admin approves.

A plate number belongs to one vehicle, so "editing vehicle details" means replacing the vehicle. Until an
admin approves, the rider keeps driving the current (verified) vehicle; on approval the old vehicle is
retired (its row stays, since past trips reference it) and the new one becomes active and verified.
"""

from typing import Annotated, Literal
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select

from app.brta import normalize_plate
from app.config import settings
from app.db import utcnow
from app.models import VEHICLE_CHANGE_DOC_TYPES, Rider, RiderDocument, Vehicle, VehicleChange
from app.realtime import ADMINS, emit
from app.routers.documents import doc_out
from app.schemas import VehicleChangeIn, VehicleChangeReviewIn, iso_utc
from app.security import DB, Admin, CurrentRider, account_is_suspended
from app.services import documents as docs
from app.services import trips as trip_service

router = APIRouter(prefix="/api", tags=["vehicle-changes"])


def _change_docs(db: DB, change: VehicleChange) -> dict[str, RiderDocument]:
    rows = db.scalars(
        select(RiderDocument)
        .where(RiderDocument.vehicle_change_id == change.id)
        .order_by(RiderDocument.uploaded_at)
    ).all()
    return {d.doc_type: d for d in rows}


def change_out(db: DB, change: VehicleChange) -> dict:
    by_type = _change_docs(db, change)
    if change.status == "approved" and "registration" not in by_type:
        reg = db.scalar(
            select(RiderDocument)
            .where(
                RiderDocument.rider_id == change.rider_id,
                RiderDocument.doc_type == "registration",
                RiderDocument.uploaded_at >= change.created_at,
            )
            .order_by(RiderDocument.uploaded_at.desc())
        )
        if reg:
            by_type["registration"] = reg

    required = [
        {
            "doc_type": t,
            "label": docs.DOC_LABEL.get(t, t.replace("_", " ").title()),
            "document": doc_out(by_type[t]) if t in by_type else None,
        }
        for t in VEHICLE_CHANGE_DOC_TYPES
    ]
    return {
        "id": change.id,
        "vehicle_type": change.vehicle_type,
        "plate_no": change.plate_no,
        "model": change.model,
        "color": change.color,
        "registration_no": change.registration_no,
        "status": change.status,
        "review_note": change.review_note,
        "created_at": iso_utc(change.created_at),
        "reviewed_at": iso_utc(change.reviewed_at),
        "documents": required,
        "documents_complete": all(r["document"] is not None for r in required),
    }


def _latest_change(db: DB, rider_id: str) -> VehicleChange | None:
    return db.scalar(
        select(VehicleChange)
        .where(VehicleChange.rider_id == rider_id, VehicleChange.status != "cancelled")
        .order_by(VehicleChange.created_at.desc())
    )


def _pending_change(db: DB, rider_id: str) -> VehicleChange | None:
    return db.scalar(
        select(VehicleChange)
        .where(VehicleChange.rider_id == rider_id, VehicleChange.status == "pending")
    )


def _cancel(db: DB, change: VehicleChange) -> list[RiderDocument]:
    superseded = list(_change_docs(db, change).values())
    for d in superseded:
        db.delete(d)
    change.status = "cancelled"
    return superseded


def _require_verified_rider(rider: Rider) -> None:
    if rider.status == "suspended" or account_is_suspended(rider.profile):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your account is suspended. Contact support.",
        )
    if rider.status != "verified":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only verified riders can submit a vehicle change request",
        )


def pending_change_rider_ids(db: DB) -> set[str]:
    return set(
        db.scalars(
            select(VehicleChange.rider_id).where(VehicleChange.status == "pending")
        )
    )


@router.get("/rider/vehicle-change")
def my_vehicle_change(db: DB, rider: CurrentRider):
    """The latest request (pending, rejected or approved), or null."""
    change = _latest_change(db, rider.id)
    return change_out(db, change) if change else None


@router.post("/rider/vehicle-change", status_code=status.HTTP_201_CREATED)
def request_vehicle_change(body: VehicleChangeIn, db: DB, rider: CurrentRider):
    _require_verified_rider(rider)
    plate = normalize_plate(body.plate_no, body.vehicle_type)
    if rider.vehicle and rider.vehicle.plate_no.strip().upper() == plate:
        raise HTTPException(
            422,
            "That's the vehicle you already drive. Enter the new vehicle's plate number.",
        )
    taken = db.scalar(
        select(Vehicle.id).where(
            Vehicle.plate_no == plate,
            Vehicle.retired_at.is_(None),
            Vehicle.rider_id != rider.id,
        )
    )
    if taken:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A vehicle with this plate number is already registered",
        )

    old = _pending_change(db, rider.id)
    superseded_docs = _cancel(db, old) if old else []

    color = body.color.strip() if body.color and body.color.strip() else None
    registration_no = (
        body.registration_no.strip().upper()
        if body.registration_no and body.registration_no.strip()
        else None
    )

    change = VehicleChange(
        rider_id=rider.id,
        vehicle_type=body.vehicle_type,
        plate_no=plate,
        model=body.model.strip(),
        color=color,
        registration_no=registration_no,
        status="pending",
    )
    db.add(change)
    # Documents are optional, so the admin can review the request as soon as it exists.
    emit(
        db,
        ADMINS,
        "riders.changed",
        notify=(
            "Vehicle change to review",
            f"{rider.profile.full_name} submitted a new vehicle.",
        ),
    )
    db.commit()
    for d in superseded_docs:
        docs.delete_file(d)
    return change_out(db, change)


@router.post("/rider/vehicle-change/documents")
def upload_vehicle_change_document(
    db: DB,
    rider: CurrentRider,
    doc_type: Annotated[Literal["registration", "vehicle_photo"], Form()],
    file: UploadFile = File(...),
):
    _require_verified_rider(rider)
    change = _pending_change(db, rider.id)
    if not change:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start a vehicle change first")

    limit = int(settings.max_upload_mb * 1024 * 1024)
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"Files must be under {settings.max_upload_mb:g} MB",
        )
    stored = docs.store_bytes(data, file.content_type or "")

    old = _change_docs(db, change).get(doc_type)
    if old:
        db.delete(old)

    doc = RiderDocument(
        rider_id=rider.id,
        vehicle_change_id=change.id,
        doc_type=doc_type,
        stored_name=stored,
        original_name=(file.filename or "")[:200],
        content_type=file.content_type,
        size_bytes=len(data),
    )
    db.add(doc)
    db.flush()

    out = change_out(db, change)
    if out["documents_complete"]:
        emit(
            db,
            ADMINS,
            "riders.changed",
            notify=(
                "Vehicle change to review",
                f"{rider.profile.full_name} submitted a new vehicle.",
            ),
        )
    else:
        emit(db, ADMINS, "riders.changed")
    try:
        db.commit()
    except Exception:
        db.rollback()
        (docs.upload_root() / stored).unlink(missing_ok=True)
        raise
    if old:
        docs.delete_file(old)
    return out


@router.delete("/rider/vehicle-change", status_code=status.HTTP_204_NO_CONTENT)
def cancel_vehicle_change(db: DB, rider: CurrentRider):
    change = _pending_change(db, rider.id)
    if not change:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No vehicle change in progress")
    superseded_docs = _cancel(db, change)
    emit(db, ADMINS, "riders.changed")
    db.commit()
    for d in superseded_docs:
        docs.delete_file(d)


@router.get("/admin/riders/{rider_id}/vehicle-change")
def rider_vehicle_change(rider_id: str, db: DB, admin: Admin):
    change = _pending_change(db, rider_id)
    return change_out(db, change) if change else None


@router.post("/admin/vehicle-changes/{change_id}/review")
def review_vehicle_change(
    change_id: str, body: VehicleChangeReviewIn, db: DB, admin: Admin
):
    change = db.get(VehicleChange, change_id)
    if not change or change.status != "pending":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No pending vehicle change"
        )

    rider = db.get(Rider, change.rider_id)
    by_type = _change_docs(db, change)
    now = utcnow()
    note = body.note.strip()

    if body.status == "rejected":
        if not note:
            raise HTTPException(
                422, "Tell the rider why the vehicle was rejected"
            )
        for d in by_type.values():
            d.status = "rejected"
            d.review_note = note
            d.reviewed_by = admin.id
            d.reviewed_at = now
        change.status = "rejected"
        change.review_note = note
        change.reviewed_by = admin.id
        change.reviewed_at = now
        notify = (
            "Vehicle change rejected",
            note,
        )
    else:
        if trip_service.active_trip_for_rider(db, rider.id):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Cannot approve vehicle change while the rider has an active trip",
            )
        taken = db.scalar(
            select(Vehicle.id).where(
                Vehicle.plate_no == change.plate_no,
                Vehicle.retired_at.is_(None),
                Vehicle.rider_id != rider.id,
            )
        )
        if taken:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Another rider has registered this plate number since",
            )

        for d in by_type.values():
            d.status = "approved"
            d.review_note = note or None
            d.reviewed_by = admin.id
            d.reviewed_at = now

        for v in rider.vehicles:
            if v.retired_at is None:
                v.retired_at = now

        new_v = Vehicle(
            rider_id=rider.id,
            vehicle_type=change.vehicle_type,
            plate_no=change.plate_no,
            model=change.model,
            color=change.color,
            registration_no=change.registration_no,
            verified=True,
        )
        db.add(new_v)
        reg_doc = by_type.get("registration")
        if reg_doc:
            reg_doc.vehicle_change_id = None

        change.status = "approved"
        change.review_note = note or None
        change.reviewed_by = admin.id
        change.reviewed_at = now
        notify = (
            "New vehicle approved",
            f"You're now driving {change.model} · {change.plate_no}.",
        )

    emit(db, rider.profile_id, "profile.updated", notify=notify)
    emit(db, ADMINS, "riders.changed")
    db.commit()
    db.refresh(change)
    return change_out(db, change)

