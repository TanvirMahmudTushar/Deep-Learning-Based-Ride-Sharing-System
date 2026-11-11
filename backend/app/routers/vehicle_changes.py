"""Vehicle changes: a rider asks to switch vehicles, uploads the new vehicle's papers, and an admin approves.

A plate number belongs to one vehicle, so "editing vehicle details" means replacing the vehicle. Until an
admin approves, the rider keeps driving the current (verified) vehicle; on approval the old vehicle is
retired (its row stays, since past trips reference it) and the new one becomes active and verified.
"""

from typing import Annotated, Literal
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import settings
from app.db import utcnow
from app.models import VEHICLE_CHANGE_DOC_TYPES, Rider, RiderDocument, Vehicle, VehicleChange
from app.realtime import ADMINS, emit
from app.routers.documents import doc_out
from app.schemas import VehicleType, iso_utc
from app.security import DB, Admin, CurrentRider
from app.services import documents as docs

router = APIRouter(prefix="/api", tags=["vehicle-changes"])


class VehicleChangeIn(BaseModel):
    vehicle_type: VehicleType
    plate_no: str = Field(min_length=2, max_length=32)
    model: str = Field(min_length=2, max_length=60)


class VehicleChangeReviewIn(BaseModel):
    status: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=300)


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


def _cancel(db: DB, change: VehicleChange) -> None:
    for d in _change_docs(db, change).values():
        docs.delete_file(d)
        db.delete(d)
    change.status = "cancelled"


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
    plate = body.plate_no.strip().upper()
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
    if old:
        _cancel(db, old)

    change = VehicleChange(
        rider_id=rider.id,
        vehicle_type=body.vehicle_type,
        plate_no=plate,
        model=body.model.strip(),
        status="pending",
    )
    db.add(change)
    emit(ADMINS, "riders.changed")
    db.commit()
    return change_out(db, change)


@router.post("/rider/vehicle-change/documents")
async def upload_vehicle_change_document(
    db: DB,
    rider: CurrentRider,
    doc_type: Annotated[Literal["registration", "vehicle_photo"], Form()],
    file: UploadFile = File(...),
):
    change = _pending_change(db, rider.id)
    if not change:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start a vehicle change first")

    limit = int(settings.max_upload_mb * 1024 * 1024)
    data = await file.read()
    stored = docs.store_bytes(data, doc_type, file.content_type, limit=limit)

    old = _change_docs(db, change).get(doc_type)
    if old:
        docs.delete_file(old)
        db.delete(old)

    doc = RiderDocument(
        rider_id=rider.id,
        vehicle_change_id=change.id,
        doc_type=doc_type,
        stored_name=stored.name,
        original_name=(file.filename or "")[:200],
        content_type=stored.content_type,
        size_bytes=len(data),
    )
    db.add(doc)
    db.flush()

    out = change_out(db, change)
    if out["documents_complete"]:
        emit(
            ADMINS,
            "riders.changed",
            notify={
                "title": "Vehicle change to review",
                "body": f"{rider.profile.full_name} submitted a new vehicle.",
            },
        )
    else:
        emit(ADMINS, "riders.changed")
    db.commit()
    return out


@router.delete("/rider/vehicle-change", status_code=status.HTTP_204_NO_CONTENT)
def cancel_vehicle_change(db: DB, rider: CurrentRider):
    change = _pending_change(db, rider.id)
    if not change:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No vehicle change in progress")
    _cancel(db, change)
    emit(ADMINS, "riders.changed")
    db.commit()


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
        notify = {
            "title": "Vehicle change rejected",
            "body": note,
        }
    else:
        missing = [t for t in VEHICLE_CHANGE_DOC_TYPES if t not in by_type]
        if missing:
            raise HTTPException(
                422,
                "The rider still needs to upload: "
                + ", ".join(docs.DOC_LABEL.get(t, t) for t in missing),
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
        notify = {
            "title": "New vehicle approved",
            "body": f"You're now driving {change.model} · {change.plate_no}.",
        }

    emit(rider.profile_id, "profile.updated", notify=notify)
    emit(ADMINS, "riders.changed")
    db.commit()
    db.refresh(change)
    return change_out(db, change)

