import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import DEFAULT_JWT_SECRET, settings
from app.db import SessionLocal, create_schema
from app.realtime import hub
from app.routers import admin, assistant, auth, documents, geo, meta, passenger, payments, rider, trips, ws
from app.seed import ensure_admin, seed_demo, seed_reference
from app.services import demand, simulator, weather
from app.services.documents import DocumentError
from app.services.trips import TripError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    hub.bind_loop(asyncio.get_running_loop())
    if settings.jwt_secret == DEFAULT_JWT_SECRET:
        log.warning("JWT_SECRET is the development default. Set a long random JWT_SECRET before deploying.")
    create_schema()
    with SessionLocal() as db:
        seed_reference(db)
        if created := ensure_admin(db):
            log.info("Created admin account %s", created)
        if settings.demo_mode and seed_demo(db):
            log.info("Demo mode: seeded demo accounts, simulated riders and synthetic trips")
        await asyncio.to_thread(weather.refresh_weather, db)
        demand.refresh_forecasts(db)

    log.info("Running in %s mode", "DEMO" if settings.demo_mode else "real")
    task = asyncio.create_task(simulator.run_forever()) if settings.simulator_enabled else None
    yield
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="Deep Learning Ride-Sharing API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(TripError)
def trip_error_handler(_: Request, exc: TripError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(DocumentError)
def document_error_handler(_: Request, exc: DocumentError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


for r in (meta, auth, geo, trips, passenger, rider, documents, payments, admin, assistant, ws):
    app.include_router(r.router)
