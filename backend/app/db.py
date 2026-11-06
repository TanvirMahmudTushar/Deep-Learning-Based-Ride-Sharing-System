from collections.abc import Iterator
from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False, "timeout": 15} if _is_sqlite else {},
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def create_schema() -> None:
    """Create missing tables, then add any new nullable columns to existing ones.

    A forward-only stand-in for migrations while the schema is still moving: it never drops or
    alters existing columns, so older databases keep their data.
    """
    Base.metadata.create_all(engine)
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing and col.nullable:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col.type.compile(engine.dialect)}'))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Bangladesh has no daylight saving, so a fixed offset is exact (and avoids needing tzdata on Windows).
DHAKA_TZ = timezone(timedelta(hours=6))


def utcnow() -> datetime:
    """Naive UTC timestamp; every datetime in the database is naive UTC."""
    return datetime.now(UTC).replace(tzinfo=None)


def local_time(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC).astimezone(DHAKA_TZ)


def local_day_start() -> datetime:
    """Start of today in Dhaka, as naive UTC."""
    midnight = local_time(utcnow()).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(UTC).replace(tzinfo=None)


def local_month_start() -> datetime:
    """Start of this month in Dhaka, as naive UTC."""
    first = local_time(utcnow()).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return first.astimezone(UTC).replace(tzinfo=None)
