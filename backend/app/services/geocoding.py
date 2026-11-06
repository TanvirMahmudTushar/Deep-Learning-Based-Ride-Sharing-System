"""Address search and reverse geocoding through OpenStreetMap Nominatim.

Follows the public server's usage policy: an identifying User-Agent, at most one request per
second (enforced here for the whole process), results cached, and search on submit only (the
frontend never calls this per keystroke). Every caller has a fallback, so the app keeps working
offline or when Nominatim is slow.
"""

import logging
import threading
import time
from collections import OrderedDict

import httpx

from app.config import settings

log = logging.getLogger(__name__)

_lock = threading.Lock()
_last_call = 0.0
_cache: OrderedDict[tuple, object] = OrderedDict()
_CACHE_SIZE = 2000

# Rough box around greater Dhaka; results inside it are preferred, not required.
VIEWBOX = "90.20,23.95,90.60,23.65"


def _cached(key: tuple):
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    return None


def _store(key: tuple, value) -> None:
    with _lock:
        _cache[key] = value
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)


def _get(path: str, params: dict) -> object | None:
    global _last_call
    if not settings.use_geocoding:
        return None
    if settings.geocoder_email:
        params = {**params, "email": settings.geocoder_email}
    with _lock:  # one request per second across all threads
        wait = 1.0 - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
    try:
        resp = httpx.get(
            f"{settings.nominatim_url}{path}",
            params={**params, "format": "jsonv2", "accept-language": "en"},
            headers={"User-Agent": settings.geocoder_user_agent},
            timeout=5.0,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        log.warning("Nominatim unavailable: %s", exc)
        return None


def short_name(item: dict) -> str:
    """Short label such as 'Dhanmondi Lake, Dhanmondi' or '12 Road 5, Banani' from a Nominatim result."""
    a = item.get("address") or {}
    road = a.get("road")
    street = " ".join(p for p in (a.get("house_number"), road) if p)
    name = item.get("name") or ""
    area = a.get("neighbourhood") or a.get("suburb") or a.get("quarter") or a.get("city_district") or a.get("city")
    parts = [name or street]
    if name and road and road not in name:
        parts.append(road)
    parts.append(area)
    label = ", ".join(dict.fromkeys(p for p in parts if p))  # drop blanks and repeats, keep order
    return (label or item.get("display_name", ""))[:160]


def search(query: str, near: tuple[float, float] | None = None, limit: int = 6) -> list[dict]:
    q = " ".join(query.split())[:120]
    if len(q) < 3:
        return []
    key = ("search", q.lower(), limit)
    hit = _cached(key)
    if hit is not None:
        return hit  # type: ignore[return-value]
    data = _get(
        "/search",
        {"q": q, "countrycodes": "bd", "viewbox": VIEWBOX, "bounded": 0, "addressdetails": 1, "limit": limit},
    )
    if not isinstance(data, list):
        return []
    results = [
        {"label": short_name(it), "address": it.get("display_name", ""), "lat": float(it["lat"]), "lng": float(it["lon"])}
        for it in data
        if "lat" in it and "lon" in it
    ]
    _store(key, results)
    return results


def reverse(lat: float, lng: float) -> str | None:
    key = ("reverse", round(lat, 4), round(lng, 4))  # ~11 m grid
    hit = _cached(key)
    if hit is not None:
        return hit or None  # type: ignore[return-value]
    data = _get("/reverse", {"lat": lat, "lon": lng, "zoom": 18, "addressdetails": 1})
    label = short_name(data) if isinstance(data, dict) and "error" not in data else ""
    _store(key, label)
    return label or None
