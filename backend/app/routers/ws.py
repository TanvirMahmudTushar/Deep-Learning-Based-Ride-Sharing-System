"""WebSocket endpoint. The client authenticates with its first message, so the JWT never appears in a URL."""

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db import SessionLocal
from app.realtime import hub
from app.security import profile_from_token

router = APIRouter()

AUTH_TIMEOUT_SECONDS = 10


def _authenticate(token: str | None) -> tuple[str, str] | None:
    with SessionLocal() as db:
        profile = profile_from_token(db, token)
        return (profile.id, profile.role) if profile else None


@router.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=AUTH_TIMEOUT_SECONDS)
        who = await asyncio.to_thread(_authenticate, first.get("token") if first.get("type") == "auth" else None)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError, AttributeError):
        who = None
    if who is None:
        with contextlib.suppress(Exception):
            await ws.close(code=4401, reason="unauthorized")
        return

    hub.bind_loop(asyncio.get_running_loop())
    await hub.connect(ws, *who)
    try:
        await ws.send_json({"type": "ready", "role": who[1]})
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws)
