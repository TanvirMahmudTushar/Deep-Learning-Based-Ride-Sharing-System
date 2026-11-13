"""Favourite and blocked riders (#47).

Blocked riders are never offered the passenger's trips. Favourites who are nearby, free and have the
right vehicle are offered the trip before everyone else; when none is available, matching is unchanged.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import RiderPreference, Trip

LIMITS = {"favourite": 20, "blocked": 50}


def _ids(db: Session, user_id: str, kind: str) -> set[str]:
    return set(db.scalars(select(RiderPreference.rider_id).where(RiderPreference.user_id == user_id, RiderPreference.kind == kind)))


def blocked_ids(db: Session, user_id: str) -> set[str]:
    return _ids(db, user_id, "blocked")


def favourite_ids(db: Session, user_id: str) -> set[str]:
    return _ids(db, user_id, "favourite")


def get(db: Session, user_id: str, rider_id: str) -> RiderPreference | None:
    return db.scalar(select(RiderPreference).where(RiderPreference.user_id == user_id, RiderPreference.rider_id == rider_id))


def count(db: Session, user_id: str, kind: str) -> int:
    return db.scalar(select(func.count(RiderPreference.id)).where(RiderPreference.user_id == user_id, RiderPreference.kind == kind)) or 0


def rode_with(db: Session, user_id: str, rider_id: str, completed_only: bool) -> bool:
    """A favourite needs a finished trip together; a block only needs the rider to have taken one of your trips."""
    q = select(Trip.id).where(Trip.user_id == user_id, Trip.rider_id == rider_id)
    if completed_only:
        q = q.where(Trip.status == "completed")
    return db.scalar(q.limit(1)) is not None


def blocked_counts(db: Session) -> dict[str, int]:
    """How many passengers have blocked each rider, for the admin riders list."""
    rows = db.execute(
        select(RiderPreference.rider_id, func.count()).where(RiderPreference.kind == "blocked").group_by(RiderPreference.rider_id)
    )
    return {rid: int(n) for rid, n in rows}
