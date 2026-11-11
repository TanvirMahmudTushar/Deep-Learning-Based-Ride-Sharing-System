"""Slows down password guessing by counting failed logins.

Counts live in memory, so they reset on restart and aren't shared between server processes.
"""

import threading
import time

from app.config import settings

# A wide limit per email and per address catches guessing spread across many addresses or accounts.
_WIDE_LIMIT_FACTOR = 10
_MAX_TRACKED_KEYS = 10_000

_failures: dict[str, list[float]] = {}
_lock = threading.Lock()


def _limits(email: str, ip: str) -> list[tuple[str, int]]:
    wide = settings.login_max_failures * _WIDE_LIMIT_FACTOR
    return [(f"pair:{ip}:{email}", settings.login_max_failures), (f"email:{email}", wide), (f"ip:{ip}", wide)]


def _window() -> float:
    return settings.login_lockout_minutes * 60.0


def _now() -> float:
    return time.monotonic()


def retry_after(email: str, ip: str) -> int:
    """Seconds until this login may be attempted again; 0 if it may be attempted now."""
    now = _now()
    wait = 0.0
    with _lock:
        for key, limit in _limits(email, ip):
            recent = [t for t in _failures.get(key, []) if now - t < _window()]
            if len(recent) >= limit:
                # Allowed again once enough of the oldest failures have aged out.
                wait = max(wait, recent[len(recent) - limit] + _window() - now)
    return int(wait) + 1 if wait else 0


def record_failure(email: str, ip: str) -> None:
    now = _now()
    with _lock:
        if len(_failures) >= _MAX_TRACKED_KEYS:
            for key in [k for k, times in _failures.items() if not times or now - times[-1] >= _window()]:
                del _failures[key]
        if len(_failures) < _MAX_TRACKED_KEYS:
            for key, _ in _limits(email, ip):
                _failures.setdefault(key, []).append(now)


def clear(email: str, ip: str) -> None:
    """A correct password forgives the failures for this email from this address."""
    with _lock:
        _failures.pop(_limits(email, ip)[0][0], None)


def reset() -> None:
    with _lock:
        _failures.clear()
