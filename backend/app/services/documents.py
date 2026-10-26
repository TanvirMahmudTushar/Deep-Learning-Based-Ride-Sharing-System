"""Rider verification documents stored on local disk.

Files are saved under settings.upload_dir with random names (never the uploaded file name), and
served only through an authenticated endpoint to the owning rider or an admin. The type is
checked against the file's first bytes, not just the client-sent content type.
"""

import secrets
import struct
import zlib
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import DOCUMENT_TYPES, Rider, RiderDocument

DOC_LABEL = {"license": "Driving licence", "registration": "Vehicle registration", "photo": "Profile photo"}

# content type -> (extension, magic-byte check)
ALLOWED = {
    "image/jpeg": (".jpg", lambda b: b[:3] == b"\xff\xd8\xff"),
    "image/png": (".png", lambda b: b[:8] == b"\x89PNG\r\n\x1a\n"),
    "image/webp": (".webp", lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP"),
    "application/pdf": (".pdf", lambda b: b[:5] == b"%PDF-"),
}


class DocumentError(ValueError):
    pass


def upload_root() -> Path:
    root = Path(settings.upload_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def store_bytes(data: bytes, content_type: str) -> str:
    if content_type not in ALLOWED:
        raise DocumentError("Upload a JPG, PNG, WebP or PDF file")
    ext, check = ALLOWED[content_type]
    if not check(data):
        raise DocumentError("The file's contents don't match its type")
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise DocumentError(f"Files must be under {settings.max_upload_mb:g} MB")
    name = secrets.token_hex(16) + ext
    (upload_root() / name).write_bytes(data)
    return name


def path_for(doc: RiderDocument) -> Path:
    path = (upload_root() / doc.stored_name).resolve()
    if path.parent != upload_root():  # stored names are generated, but never trust a path
        raise DocumentError("Invalid document path")
    return path


def delete_file(doc: RiderDocument) -> None:
    try:
        path_for(doc).unlink(missing_ok=True)
    except DocumentError:
        pass


def latest_by_type(db: Session, rider_id: str) -> dict[str, RiderDocument]:
    docs = db.scalars(select(RiderDocument).where(RiderDocument.rider_id == rider_id).order_by(RiderDocument.uploaded_at)).all()
    return {d.doc_type: d for d in docs}  # later uploads replace earlier ones


def verification_ready(db: Session, rider: Rider) -> tuple[bool, list[str]]:
    """Whether every required document is approved; returns the missing/unapproved labels."""
    if rider.is_simulated:
        return True, []
    latest = latest_by_type(db, rider.id)
    missing = [DOC_LABEL[t] for t in DOCUMENT_TYPES if t not in latest or latest[t].status != "approved"]
    return not missing, missing


def placeholder_png(label: str, rgb: tuple[int, int, int] = (60, 60, 58), size: tuple[int, int] = (320, 200)) -> bytes:
    """A plain solid-colour PNG, used for demo-mode documents (no image library needed)."""
    w, h = size
    row = b"\x00" + bytes(rgb) * w
    raw = row * h

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    text = chunk(b"tEXt", b"Comment\x00" + label.encode("latin-1", "replace"))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + text + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
