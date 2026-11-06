"""Address search and reverse geocoding, proxied so the policy-required User-Agent, rate limit and cache apply."""

from fastapi import APIRouter, Query

from app.security import DB, CurrentUser
from app.services import geocoding
from app.services.zones import describe_point

router = APIRouter(prefix="/api/geo", tags=["geo"])


@router.get("/search")
def search(user: CurrentUser, q: str = Query(min_length=3, max_length=120)):
    """Search on submit only: Nominatim's usage policy does not allow search-as-you-type."""
    return geocoding.search(q)


@router.get("/reverse")
def reverse(db: DB, user: CurrentUser, lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180)):
    return {"label": describe_point(db, (lat, lng)), "lat": lat, "lng": lng}
