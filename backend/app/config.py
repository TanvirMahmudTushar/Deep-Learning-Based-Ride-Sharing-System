import secrets

from pydantic_settings import BaseSettings, SettingsConfigDict

# The old built-in default. It is public in the repo's history, so tokens signed with it could be forged.
_PUBLISHED_JWT_SECRET = "dev-only-secret-change-me-in-production-0000"


class Settings(BaseSettings):
    # The repo-root .env (shared with docker compose); a backend/.env, if present, overrides it.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "sqlite:///./ridesharing.db"
    jwt_secret: str = ""
    jwt_secret_generated: bool = False
    jwt_expire_minutes: int = 60 * 24
    # Failed logins for one email from one address before it is locked out for a while.
    login_max_failures: int = 5
    login_lockout_minutes: int = 15
    cors_origins: list[str] = []
    # Any localhost port by default, so the frontend works whichever port `next dev` picks.
    cors_origin_regex: str | None = r"http://(localhost|127\.0\.0\.1)(:\d+)?"

    # Real mode (default): empty database, real accounts only. Demo mode adds demo accounts,
    # simulated riders, 14 days of synthetic trips and the trip simulator.
    demo_mode: bool = False
    # First admin account, created on startup if no admin exists yet.
    admin_email: str | None = None
    admin_password: str | None = None
    admin_name: str = "Platform Admin"

    # Groq (OpenAI-compatible). Without a key every text feature falls back to a template.
    groq_api_key: str | None = None
    groq_price_model: str = "llama-3.1-8b-instant"
    groq_alert_model: str = "llama-3.3-70b-versatile"
    groq_assistant_model: str = "openai/gpt-oss-20b"

    # External data sources; all fall back gracefully when offline.
    osrm_url: str = "https://router.project-osrm.org"
    use_osrm: bool = True
    use_weather: bool = True
    use_geocoding: bool = True
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    # Nominatim's usage policy requires an identifying User-Agent; add a contact email if you deploy.
    geocoder_user_agent: str = "Cholo/0.2 (ride-sharing research prototype)"
    geocoder_email: str | None = None
    city_lat: float = 23.8103
    city_lng: float = 90.4125

    # Trip simulator: drives simulated riders and rider-portal trips with auto-drive on.
    # Follows demo_mode unless set explicitly (tests use demo data without the background loop).
    run_simulator: bool | None = None
    simulator_tick_seconds: float = 2.0
    simulator_speedup: float = 10.0
    simulator_anomaly_rate: float = 0.15
    simulator_accept_delay_seconds: float = 3.0

    offer_timeout_seconds: int = 30
    match_radius_km: float = 8.0
    # Riders whose app has not sent a location for this long are not offered trips.
    rider_stale_seconds: int = 120
    # GPS fixes less accurate than this are stored but ignored by the anomaly detector.
    gps_max_accuracy_m: float = 75.0
    # Rider within this distance of the pickup counts as "arrived".
    arrival_radius_m: float = 150.0

    # Cash payments: platform share of each fare when no per-vehicle rate is set.
    default_commission_pct: float = 15.0

    # Rider documents
    upload_dir: str = "./uploads"
    max_upload_mb: float = 5.0

    def model_post_init(self, _context: object) -> None:
        # Without a real secret, sign with a random one: everyone is logged out on restart, but
        # nobody can forge a token. A blank JWT_SECRET= (as in .env.example) means "not set".
        self.jwt_secret_generated = self.jwt_secret in ("", _PUBLISHED_JWT_SECRET)
        if self.jwt_secret_generated:
            self.jwt_secret = secrets.token_urlsafe(48)

    @property
    def simulator_enabled(self) -> bool:
        return self.demo_mode if self.run_simulator is None else self.run_simulator


settings = Settings()
