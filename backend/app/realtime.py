"""Real-time events over WebSockets.

Services call `emit(db, audience, type, ...)` while they change data. Events are held on the
session and only sent after the transaction commits (and dropped on rollback), so a client that
refetches on an event always sees the committed state. Clients treat events mostly as "refresh
this" signals; the REST API stays the source of truth.

Publishing is thread-safe: endpoints run in FastAPI's thread pool and the simulator in its own
thread, so messages are handed to the event loop with run_coroutine_threadsafe.
"""

import asyncio
import contextlib
import json
import logging
import threading
import time
from collections import defaultdict
from collections.abc import Iterable

from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

ADMINS = "admins"
# Of the events sent to ADMINS, the ones approved support agents also get. Everything else
# (payments, riders, settlements) stays admin-only.
SUPPORT_EVENTS = frozenset({"alert.new", "alert.updated", "live.changed"})
_PENDING = "realtime_events"


class Hub:
    def __init__(self) -> None:
        self._by_profile: dict[str, set[WebSocket]] = defaultdict(set)
        self._roles: dict[WebSocket, tuple[str, str]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()
        # Coalescing: high-frequency events (rider positions for admins) go out at most once per interval.
        self._last_sent: dict[str, float] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket, profile_id: str, role: str) -> None:
        with self._lock:
            self._by_profile[profile_id].add(ws)
            self._roles[ws] = (profile_id, role)

    def disconnect(self, ws: WebSocket) -> None:
        with self._lock:
            info = self._roles.pop(ws, None)
            if info:
                self._by_profile[info[0]].discard(ws)

    def online_profiles(self) -> set[str]:
        with self._lock:
            return {pid for pid, conns in self._by_profile.items() if conns}

    def _targets(self, audience: Iterable[str], event_type: str | None = None) -> list[WebSocket]:
        with self._lock:
            out: list[WebSocket] = []
            staff_roles = {"admin", "support"} if event_type in SUPPORT_EVENTS else {"admin"}
            for a in audience:
                if a == ADMINS:
                    out.extend(ws for ws, (_, role) in self._roles.items() if role in staff_roles)
                else:
                    out.extend(self._by_profile.get(a, ()))
            return list(dict.fromkeys(out))

    async def _send(self, targets: list[WebSocket], text: str) -> None:
        for ws in targets:
            try:
                await ws.send_text(text)
            except Exception:  # client went away mid-send
                self.disconnect(ws)

    def publish(self, audience: Iterable[str], message: dict, coalesce: str | None = None, interval: float = 2.0) -> None:
        if self._loop is None or self._loop.is_closed():
            return
        if coalesce:
            now = time.monotonic()
            with self._lock:
                if now - self._last_sent.get(coalesce, 0) < interval:
                    return
                self._last_sent[coalesce] = now
        targets = self._targets(audience, message.get("type"))
        if not targets:
            return
        self._submit(self._send(targets, json.dumps(message, default=str)))

    def close_profile(self, profile_id: str, code: int = 4403) -> None:
        """Disconnect every socket of one profile, such as a support agent whose access was removed."""
        if self._loop is None or self._loop.is_closed():
            return
        with self._lock:
            sockets = list(self._by_profile.get(profile_id, ()))
        for ws in sockets:
            self.disconnect(ws)
        if sockets:
            self._submit(self._close(sockets, code))

    async def _close(self, sockets: list[WebSocket], code: int) -> None:
        for ws in sockets:
            with contextlib.suppress(Exception):
                await ws.close(code=code, reason="access removed")

    def _submit(self, coro) -> None:
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self._loop:
            self._loop.create_task(coro)
        else:
            asyncio.run_coroutine_threadsafe(coro, self._loop)


hub = Hub()


def emit(
    db: Session,
    audience: Iterable[str | None] | str,
    type: str,
    notify: tuple[str, str] | None = None,
    coalesce: str | None = None,
    **data,
) -> None:
    """Queue an event for delivery after the current transaction commits.

    `audience` is profile ids and/or ADMINS. `notify` is a (title, body) pair the client shows as
    a toast and, when permitted, a browser notification.
    """
    targets = [audience] if isinstance(audience, str) else [a for a in audience if a]
    message = {"type": type, **data}
    if notify:
        message["notify"] = {"title": notify[0], "body": notify[1]}
    db.info.setdefault(_PENDING, []).append((targets, message, coalesce))


@event.listens_for(Session, "after_commit")
def _flush(session: Session) -> None:
    for targets, message, coalesce in session.info.pop(_PENDING, []):
        hub.publish(targets, message, coalesce=coalesce)


@event.listens_for(Session, "after_rollback")
def _discard(session: Session) -> None:
    session.info.pop(_PENDING, None)
