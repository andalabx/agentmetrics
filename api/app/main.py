import gzip
import logging
import sys
import time

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send
from alembic.config import Config
from alembic import command

from app.config import settings
from app.routers import auth, events, agents, recommendations, alerts, activity, stats, fleet, runs, slo, audit
from app.worker import start_worker, stop_worker

logger = logging.getLogger("agentmetrics")


class GzipRequestMiddleware:
    """Transparently decompress gzip-encoded request bodies before routing."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            if headers.get("content-encoding", "").lower() == "gzip":
                # Consume the full body
                chunks: list[bytes] = []
                more = True
                while more:
                    msg = await receive()
                    chunks.append(msg.get("body", b""))
                    more = msg.get("more_body", False)
                raw = b"".join(chunks)
                try:
                    raw = gzip.decompress(raw)
                except Exception:
                    pass  # pass malformed body through unchanged

                # Rebuild scope without the content-encoding header
                new_headers = [
                    (k, v) for k, v in scope["headers"]
                    if k.lower() != b"content-encoding"
                ]
                scope = {**scope, "headers": new_headers}

                async def new_receive() -> dict:
                    return {"type": "http.request", "body": raw, "more_body": False}

                await self.app(scope, new_receive, send)
                return

        await self.app(scope, receive, send)


def _configure_logging() -> None:
    """
    Attach a StreamHandler to the root logger.
    Must be called inside the startup event, after uvicorn has run its own
    logging.config.dictConfig - otherwise basicConfig is a no-op.
    """
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    ))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers = [handler]
    # Suppress loggers that would otherwise flood stdout
    logging.getLogger("uvicorn.access").propagate = False  # we log requests ourselves
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

app = FastAPI(
    title="AgentMetrics API",
    description="Real-time cost visibility & optimization for AI agents.",
    version="1.0.0",
    docs_url="/docs",
)

# CORS
allowed_origins = [settings.FRONTEND_URL]
if settings.ENVIRONMENT == "development":
    allowed_origins += ["http://localhost:5173", "http://localhost:3099", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GzipRequestMiddleware)


@app.on_event("startup")
def run_migrations() -> None:
    """Run alembic migrations on startup - safe because alembic is idempotent."""
    _configure_logging()
    logger.info("[startup] ENVIRONMENT=%s", settings.ENVIRONMENT)
    from app.database import IS_SQLITE, Base, engine
    if IS_SQLITE:
        # Import all models so metadata is populated before create_all
        import app.models.organization  # noqa: F401
        import app.models.event         # noqa: F401
        import app.models.metrics       # noqa: F401
        Base.metadata.create_all(bind=engine)
        logger.info("[startup] SQLite schema created")
    else:
        try:
            alembic_cfg = Config("alembic.ini")
            command.upgrade(alembic_cfg, "head")
        except Exception as e:
            logger.warning("[startup] Migration warning: %s", e)

    # Backfill any missing hourly aggregation rows from the last 48 hours
    try:
        from app.database import SessionLocal
        from app.services.aggregation_service import backfill_missing_hours
        db = SessionLocal()
        backfill_missing_hours(db)
        db.close()
    except Exception as e:
        logger.warning("[startup] Backfill warning (non-fatal): %s", e)

    # First-run: create default org and print SDK key to stdout
    _provision_default_org()

    start_worker()


def _provision_default_org() -> None:
    """Create the default organization on first run."""
    try:
        from app.database import SessionLocal
        from app.models.organization import Organization

        db = SessionLocal()
        try:
            if db.query(Organization).first():
                return  # already provisioned

            org = Organization(email="admin@localhost", company_name="My Agents")
            db.add(org)
            db.commit()

            sep = "=" * 60
            print(f"\n{sep}", flush=True)
            print("  AgentMetrics is ready", flush=True)
            print(f"  Dashboard : {settings.FRONTEND_URL}", flush=True)
            print(f"  API docs  : {settings.API_URL}/docs", flush=True)
            print(f"{sep}\n", flush=True)
            logger.info("[startup] Default organization provisioned")
        finally:
            db.close()
    except Exception as e:
        logger.warning("[startup] First-run provisioning failed (non-fatal): %s", e)


@app.on_event("shutdown")
def shutdown_worker() -> None:
    stop_worker()


@app.middleware("http")
async def access_log(request: Request, call_next) -> Response:
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    logger.info("%s %s %d %.0fms", request.method, request.url.path, response.status_code, ms)
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Routers
app.include_router(auth.router, prefix="/v1")
app.include_router(events.router, prefix="/v1")
app.include_router(agents.router, prefix="/v1")
app.include_router(recommendations.router, prefix="/v1")
app.include_router(alerts.router, prefix="/v1")
app.include_router(activity.router, prefix="/v1")
app.include_router(stats.router, prefix="/v1")
app.include_router(fleet.router, prefix="/v1")
app.include_router(runs.router, prefix="/v1")
app.include_router(slo.router, prefix="/v1")
app.include_router(audit.router, prefix="/v1")


@app.get("/health")
def health():
    return {"status": "ok"}


# Serve pre-built dashboard SPA when bundled inside the pip package.
# Build the dashboard with VITE_API_URL="" and copy dist/ → api/app/static/.
# The /v1/* API routes above always take precedence.
import pathlib as _pathlib
_static_dir = _pathlib.Path(__file__).parent / "static"
if _static_dir.is_dir():
    from fastapi.responses import FileResponse as _FileResponse
    from fastapi.staticfiles import StaticFiles as _StaticFiles

    _assets = _static_dir / "assets"
    if _assets.is_dir():
        app.mount("/assets", _StaticFiles(directory=str(_assets)), name="vite-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa(full_path: str):
        return _FileResponse(str(_static_dir / "index.html"))
else:
    @app.get("/", include_in_schema=False)
    def root():
        return RedirectResponse(url="/health")
