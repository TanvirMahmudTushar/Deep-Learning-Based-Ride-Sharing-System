"""Rider verification documents: upload (rider), review (admin), and authenticated file access."""

from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import settings
from app.db import utcnow
from app.models import DOCUMENT_TYPES, Rider, RiderDocument
from app.realtime import ADMINS, emit
from app.schemas import iso_utc
from app.security import DB, Admin, CurrentRider, CurrentUser
from app.services import documents as docs

router = APIRouter(prefix="/api", tags=["documents"])


class ReviewIn(BaseModel):
    status: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=300)


def doc_out(d: RiderDocument) -> dict:
    return {
        "id": d.id,
        "doc_type": d.doc_type,
        "label": docs.DOC_LABEL.get(d.doc_type, d.doc_type),
        "original_name": d.original_name,
        "content_type": d.content_type,
        "size_bytes": d.size_bytes,
        "status": d.status,
        "review_note": d.review_note,
        "uploaded_at": iso_utc(d.uploaded_at),
        "reviewed_at": iso_utc(d.reviewed_at),
    }


def documents_overview(db: DB, rider: Rider) -> dict:
    latest = docs.latest_by_type(db, rider.id)
    ready, missing = docs.verification_ready(db, rider)
    return {
        "required": [{"doc_type": t, "label": docs.DOC_LABEL[t], "document": doc_out(latest[t]) if t in latest else None} for t in DOCUMENT_TYPES],
        "ready": ready,
        "missing": missing,
    }


@router.get("/rider/documents")
def my_documents(db: DB, rider: CurrentRider):
    return documents_overview(db, rider)


@router.post("/rider/documents", status_code=status.HTTP_201_CREATED)
def upload_document(
    db: DB,
    rider: CurrentRider,
    doc_type: Annotated[Literal["license", "registration", "photo"], Form()],
    file: Annotated[UploadFile, File()],
):
    limit = int(settings.max_upload_mb * 1024 * 1024)
    data = file.file.read(limit + 1)
    stored = docs.store_bytes(data, file.content_type or "")

    # A new upload replaces earlier unapproved versions of the same document.
    for old in db.scalars(select(RiderDocument).where(RiderDocument.rider_id == rider.id, RiderDocument.doc_type == doc_type, RiderDocument.status != "approved")):
        docs.delete_file(old)
        db.delete(old)
    doc = RiderDocument(
        rider_id=rider.id,
        doc_type=doc_type,
        stored_name=stored,
        original_name=(file.filename or doc_type)[:200],
        content_type=file.content_type,
        size_bytes=len(data),
    )
    db.add(doc)
    emit(db, ADMINS, "riders.changed")
    db.commit()
    return doc_out(doc)


@router.get("/documents/{doc_id}/file")
def document_file(doc_id: str, db: DB, user: CurrentUser):
    doc = db.get(RiderDocument, doc_id)
    rider = db.get(Rider, doc.rider_id) if doc else None
    allowed = doc and (user.role == "admin" or (rider and rider.profile_id == user.id))
    if not allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    path = docs.path_for(doc)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File missing from storage")
    return FileResponse(path, media_type=doc.content_type, headers={"Cache-Control": "private, no-store"})


@router.get("/admin/riders/{rider_id}/documents")
def rider_documents(rider_id: str, db: DB, admin: Admin):
    rider = db.get(Rider, rider_id)
    if rider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider not found")
    return documents_overview(db, rider)


@router.post("/admin/documents/{doc_id}/review")
def review_document(doc_id: str, body: ReviewIn, db: DB, admin: Admin):
    doc = db.get(RiderDocument, doc_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if body.status == "rejected" and not body.note.strip():
        raise HTTPException(422, "Tell the rider why the document was rejected")
    doc.status = body.status
    doc.review_note = body.note.strip() or None
    doc.reviewed_by = admin.id
    doc.reviewed_at = utcnow()
    rider = db.get(Rider, doc.rider_id)
    label = docs.DOC_LABEL.get(doc.doc_type, doc.doc_type)
    notify = (f"{label} approved", "One step closer to driving.") if body.status == "approved" else (f"{label} rejected", doc.review_note or "")
    emit(db, rider.profile_id, "profile.updated", notify=notify)
    emit(db, ADMINS, "riders.changed")
    db.commit()
    return doc_out(doc)
