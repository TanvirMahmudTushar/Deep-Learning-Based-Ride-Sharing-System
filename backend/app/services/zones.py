from sqlalchemy import select
from sqlalchemy.orm import Session

from app.geo import Point, haversine_km
from app.models import Zone
from app.services import geocoding


def all_zones(db: Session) -> list[Zone]:
    return list(db.scalars(select(Zone).order_by(Zone.id)))


def nearest_zone(db: Session, p: Point) -> Zone | None:
    """Zones are Voronoi cells around their centres: a point belongs to the closest centre."""
    zones = all_zones(db)
    return min(zones, key=lambda z: haversine_km(p, (z.center_lat, z.center_lng)), default=None)


def describe_point(db: Session, p: Point) -> str:
    """Street-level name from reverse geocoding, falling back to the nearest zone."""
    name = geocoding.reverse(p[0], p[1])
    if name:
        return name
    zone = nearest_zone(db, p)
    return f"Near {zone.name}" if zone else f"{p[0]:.4f}, {p[1]:.4f}"
