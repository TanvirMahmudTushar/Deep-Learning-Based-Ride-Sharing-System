"""Small geometry helpers on (lat, lng) pairs. Distances are in kilometres."""

import math
from collections.abc import Sequence

EARTH_RADIUS_KM = 6371.0088

Point = Sequence[float]


def haversine_km(a: Point, b: Point) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def _to_xy(p: Point, ref_lat: float) -> tuple[float, float]:
    # Equirectangular projection; accurate enough at city scale.
    x = math.radians(p[1]) * math.cos(math.radians(ref_lat)) * EARTH_RADIUS_KM
    y = math.radians(p[0]) * EARTH_RADIUS_KM
    return x, y


def point_segment_km(p: Point, a: Point, b: Point) -> float:
    px, py = _to_xy(p, p[0])
    ax, ay = _to_xy(a, p[0])
    bx, by = _to_xy(b, p[0])
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def distance_to_polyline_km(p: Point, line: Sequence[Point]) -> float:
    if not line:
        return 0.0
    if len(line) == 1:
        return haversine_km(p, line[0])
    return min(point_segment_km(p, line[i], line[i + 1]) for i in range(len(line) - 1))


def polyline_length_km(line: Sequence[Point]) -> float:
    return sum(haversine_km(line[i], line[i + 1]) for i in range(len(line) - 1))


def point_along(line: Sequence[Point], km: float) -> tuple[tuple[float, float], bool]:
    """Point reached after travelling `km` along the polyline, and whether the end was reached."""
    if not line:
        raise ValueError("empty polyline")
    remaining = km
    for i in range(len(line) - 1):
        seg = haversine_km(line[i], line[i + 1])
        if seg > 0 and remaining <= seg:
            t = remaining / seg
            a, b = line[i], line[i + 1]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), False
        remaining -= seg
    end = line[-1]
    return (end[0], end[1]), True


def straight_line(a: Point, b: Point, steps: int = 24) -> list[tuple[float, float]]:
    return [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for i in range(steps + 1)]


def offset_point(p: Point, north_km: float, east_km: float) -> tuple[float, float]:
    dlat = math.degrees(north_km / EARTH_RADIUS_KM)
    dlng = math.degrees(east_km / (EARTH_RADIUS_KM * math.cos(math.radians(p[0]))))
    return p[0] + dlat, p[1] + dlng
