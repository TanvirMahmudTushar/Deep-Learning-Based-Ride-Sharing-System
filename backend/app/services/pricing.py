"""Fare estimates with a smoothed demand multiplier and a short reason shown to passengers."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.geo import Point
from app.models import PricingRule
from app.services import availability
from app.services.demand import expected_next_hour
from app.services.groq_client import explain_price
from app.services.predictors import eta_predictor, is_peak
from app.services.routing import DETOUR_FACTOR, Route
from app.services.weather import is_raining
from app.services.zones import nearest_zone

# Riders within this radius count as supply for the pickup area.
SUPPLY_RADIUS_KM = 3.0
# Demand/supply ratio below which the fare stays at 1.0x.
SURGE_FROM_RATIO = 1.2
SURGE_SLOPE = 0.25


@dataclass
class Quote:
    vehicle_type: str
    distance_km: float
    eta_min: float
    base_fare: float
    multiplier: float
    fare: float
    demand_level: str
    expected_requests: float
    available_riders: int
    nearest_pickup_eta_min: float | None
    zone_name: str
    reason: str
    breakdown: dict


def fare_breakdown(
    base_fare: float, per_km: float, per_min: float, min_fare: float, distance_km: float, eta_min: float, multiplier: float
) -> dict:
    """Fare components as shown on receipts. Amounts are in taka; `total` is what the passenger pays."""
    distance = per_km * distance_km
    time = per_min * eta_min
    raw = base_fare + distance + time
    subtotal = max(min_fare, raw)
    return {
        "base": round(base_fare, 2),
        "distance": round(distance, 2),
        "time": round(time, 2),
        "distance_km": round(distance_km, 2),
        "eta_min": round(eta_min, 1),
        "per_km": per_km,
        "per_min": per_min,
        "min_fare": min_fare,
        "min_fare_applied": raw < min_fare,
        "subtotal": round(subtotal),
        "multiplier": multiplier,
        "demand_surcharge": round(subtotal * multiplier) - round(subtotal),
        "total": float(round(subtotal * multiplier)),
    }


def demand_level(ratio: float) -> str:
    if ratio < 0.8:
        return "low"
    if ratio < 1.5:
        return "normal"
    if ratio < 2.5:
        return "high"
    return "very high"


def smooth_multiplier(ratio: float, max_multiplier: float) -> float:
    """Linear above the threshold, capped, rounded to 0.1 so prices move in small visible steps."""
    raw = 1.0 + max(0.0, ratio - SURGE_FROM_RATIO) * SURGE_SLOPE
    return round(min(raw, max_multiplier) * 10) / 10


def rule_for(db: Session, vehicle_type: str) -> PricingRule:
    rule = db.scalar(select(PricingRule).where(PricingRule.vehicle_type == vehicle_type))
    if rule is None:
        raise LookupError(f"no pricing rule for {vehicle_type}")
    return rule


def quote(db: Session, pickup: Point, route: Route, vehicle_type: str, with_reason: bool = True) -> Quote:
    now = utcnow()
    rule = rule_for(db, vehicle_type)
    zone = nearest_zone(db, pickup)
    eta = eta_predictor.predict_eta(route.distance_km, vehicle_type, now)

    nearby = availability.free_riders_near(db, pickup, vehicle_type, SUPPLY_RADIUS_KM)
    expected = expected_next_hour(db, zone.id, vehicle_type) if zone else 0.0
    ratio = expected / max(1, len(nearby))
    multiplier = smooth_multiplier(ratio, rule.max_multiplier)
    level = demand_level(ratio)

    nearest_eta = None
    candidates = nearby or availability.free_riders_near(db, pickup, vehicle_type, 8.0)
    if candidates:
        closest_km = min(availability.distance_to(r, pickup) for r in candidates) * DETOUR_FACTOR
        nearest_eta = eta_predictor.predict_eta(closest_km, vehicle_type, now)

    zone_name = zone.name if zone else "your area"
    reason = ""
    if with_reason:
        reason = explain_price(
            {
                "vehicle_type": vehicle_type,
                "zone": zone_name,
                "multiplier": multiplier,
                "demand_level": level,
                "expected_requests": expected,
                "available_riders": len(nearby),
                "raining": is_raining(db),
                "peak": is_peak(now),
            }
        )

    breakdown = fare_breakdown(rule.base_fare, rule.per_km, rule.per_min, rule.min_fare, route.distance_km, eta, multiplier)
    return Quote(
        vehicle_type=vehicle_type,
        distance_km=round(route.distance_km, 2),
        eta_min=eta,
        base_fare=breakdown["subtotal"],
        multiplier=multiplier,
        fare=breakdown["total"],
        demand_level=level,
        expected_requests=round(expected, 1),
        available_riders=len(nearby),
        nearest_pickup_eta_min=nearest_eta,
        zone_name=zone_name,
        reason=reason,
        breakdown=breakdown,
    )
