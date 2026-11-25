from fastapi import APIRouter
from sqlalchemy import select

from app.brta import BRTA_CLASS_CODES, BRTA_REGIONS
from app.config import settings
from app.models import BRTAClassCode, BRTARegion
from app.security import DB
from app.services.groq_client import groq_client
from app.services.predictors import registry
from app.services.zones import all_zones

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health")
def health():
    return {
        "status": "ok",
        "demo_mode": settings.demo_mode,
        "simulator": settings.simulator_enabled,
        "groq": groq_client.enabled,
        "osrm": settings.use_osrm,
        "geocoding": settings.use_geocoding,
        "max_upload_mb": settings.max_upload_mb,
    }


@router.get("/zones")
def zones(db: DB):
    return [{"id": z.id, "name": z.name, "lat": z.center_lat, "lng": z.center_lng} for z in all_zones(db)]


@router.get("/models")
def models():
    """Which prediction model currently backs each component (baselines until DL models are trained)."""
    return [{"component": k, "name": m.name, "kind": m.kind, "description": m.description} for k, m in registry.items()]


@router.get("/brta")
def brta_specs():
    return {
        "regions": [{"code": code, "bengali": bn} for code, bn in BRTA_REGIONS],
        "class_codes": [{"code": c, "bengali": bn, "vehicle_type": vt} for vt, items in BRTA_CLASS_CODES.items() for c, bn in items],
    }
