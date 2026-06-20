import datetime
import sqlite3

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

IS_SQLITE = settings.DATABASE_URL.startswith("sqlite")

# Python 3.12 deprecated the default sqlite3 datetime adapter. Register
# explicit adapters so SQLAlchemy doesn't trigger the DeprecationWarning.
sqlite3.register_adapter(datetime.datetime, lambda v: v.isoformat())
sqlite3.register_adapter(datetime.date, lambda v: v.isoformat())
sqlite3.register_converter("DATETIME", lambda v: datetime.datetime.fromisoformat(v.decode()))
sqlite3.register_converter("DATE", lambda v: datetime.date.fromisoformat(v.decode()))

_engine_kwargs: dict = {}
if IS_SQLITE:
    # SQLite requires check_same_thread=False for multi-threaded FastAPI usage
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

engine = create_engine(settings.DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
