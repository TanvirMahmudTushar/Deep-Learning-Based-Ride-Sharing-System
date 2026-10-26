"""Road routing through OSRM, with a straight-line fallback when OSRM is unreachable."""

import logging
from dataclasses import dataclass
from functools import lru_cache

import httpx

from app.config import settings
from app.geo import Point, haversine_km, straight_line

log = logging.getLogger(__name__)

# Typical ratio of road distance to straight-line distance in Dhaka.
DETOUR_FACTOR = 1.35


@dataclass(frozen=True)
class Route:
    points: tuple[tuple[float, float], ...]
    distance_km: float
    source: str  # "osrm" or "straight"


def get_route(a: Point, b: Point) -> Route:
    return _cached_route(round(a[0], 5), round(a[1], 5), round(b[0], 5), round(b[1], 5))


@lru_cache(maxsize=2048)
def _cached_route(alat: float, alng: float, blat: float, blng: float) -> Route:
    if settings.use_osrm:
        try:
            return _osrm_route((alat, alng), (blat, blng))
        except Exception as exc:  # network errors, bad responses, rate limiting
            log.warning("OSRM unavailable, using straight-line route: %s", exc)
    return _straight_route((alat, alng), (blat, blng))


def _osrm_route(a: Point, b: Point) -> Route:
    url = f"{settings.osrm_url}/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}"
    resp = httpx.get(url, params={"overview": "full", "geometries": "geojson"}, timeout=4.0)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        raise ValueError(f"OSRM returned {data.get('code')}")
    route = data["routes"][0]
    points = tuple((lat, lng) for lng, lat in route["geometry"]["coordinates"])
    # Anchor the route on the exact requested points (OSRM snaps to the nearest road).
    points = ((a[0], a[1]), *points, (b[0], b[1]))
    return Route(points=points, distance_km=max(route["distance"] / 1000, 0.1), source="osrm")


def _straight_route(a: Point, b: Point) -> Route:
    return Route(
        points=tuple(straight_line(a, b)),
        distance_km=max(haversine_km(a, b) * DETOUR_FACTOR, 0.1),
        source="straight",
    )
