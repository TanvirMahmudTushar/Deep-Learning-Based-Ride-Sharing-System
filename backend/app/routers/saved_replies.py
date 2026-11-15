"""Saved replies for the support desk (#60).

Agents keep their own replies; team replies are shared with every agent and only admins can add,
edit or delete them. The frontend fills placeholders such as {passenger_first_name} from the case
before the agent sends anything, so nothing here ever reaches a passenger directly.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.db import utcnow
from app.models import Profile, SavedReply
from app.schemas import iso_utc
from app.security import DB, Staff

router = APIRouter(prefix="/api/admin/saved-replies", tags=["support"])

# Report categories a reply can be suggested for; None means any report.
Category = Literal["safety", "driving", "fare", "rider_behaviour", "lost_item", "other"]
MAX_OWN_REPLIES = 50


class SavedReplyIn(BaseModel):
    title: str = Field(min_length=2, max_length=60)
    body: str = Field(min_length=3, max_length=1000)
    category: Category | None = None
    shared: bool = False


def _can_edit(reply: SavedReply, staff: Profile) -> bool:
    if reply.shared:
        return staff.role == "admin"
    return reply.owner_id == staff.id


def _out(db: DB, reply: SavedReply, staff: Profile) -> dict:
    owner = db.get(Profile, reply.owner_id) if reply.owner_id else None
    return {
        "id": reply.id,
        "title": reply.title,
        "body": reply.body,
        "category": reply.category,
        "shared": reply.shared,
        "owner_name": owner.full_name if owner else None,
        "mine": reply.owner_id == staff.id,
        "can_edit": _can_edit(reply, staff),
        "updated_at": iso_utc(reply.updated_at),
    }


def _reply_or_404(db: DB, reply_id: str, staff: Profile) -> SavedReply:
    reply = db.get(SavedReply, reply_id)
    # Another agent's private reply is reported as missing, not forbidden, so ids reveal nothing.
    if reply is None or (not reply.shared and reply.owner_id != staff.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved reply not found")
    return reply


def _check_shared(body: SavedReplyIn, staff: Profile) -> None:
    if body.shared and staff.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can add or change team replies")


@router.get("")
def list_replies(db: DB, staff: Staff):
    """Team replies and the agent's own, team replies first, then alphabetically."""
    replies = db.scalars(
        select(SavedReply)
        .where(or_(SavedReply.shared.is_(True), SavedReply.owner_id == staff.id))
        .order_by(SavedReply.shared.desc(), func.lower(SavedReply.title))
    ).all()
    return [_out(db, r, staff) for r in replies]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_reply(body: SavedReplyIn, db: DB, staff: Staff):
    _check_shared(body, staff)
    if not body.shared:
        own = db.scalar(select(func.count(SavedReply.id)).where(SavedReply.owner_id == staff.id, SavedReply.shared.is_(False))) or 0
        if own >= MAX_OWN_REPLIES:
            raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_OWN_REPLIES} saved replies")
    now = utcnow()
    reply = SavedReply(
        owner_id=staff.id,
        title=body.title.strip(),
        body=body.body.strip(),
        category=body.category,
        shared=body.shared,
        created_at=now,
        updated_at=now,
    )
    db.add(reply)
    db.commit()
    return _out(db, reply, staff)


@router.put("/{reply_id}")
def update_reply(reply_id: str, body: SavedReplyIn, db: DB, staff: Staff):
    reply = _reply_or_404(db, reply_id, staff)
    if not _can_edit(reply, staff):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can change team replies")
    _check_shared(body, staff)
    reply.title, reply.body, reply.category, reply.shared = body.title.strip(), body.body.strip(), body.category, body.shared
    reply.updated_at = utcnow()
    db.commit()
    return _out(db, reply, staff)


@router.delete("/{reply_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reply(reply_id: str, db: DB, staff: Staff):
    reply = _reply_or_404(db, reply_id, staff)
    if not _can_edit(reply, staff):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can delete team replies")
    db.delete(reply)
    db.commit()
