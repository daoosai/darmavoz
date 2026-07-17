import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import admin, admin_quarries, auth, catalog, client_addresses, client_auth, client_orders, clients, driver_dispatch, drivers, equipment, geo, logist_orders, media, orders, pickup_points, supplier_auth, supplier_points, support, system, telemetry, webhooks
from app.core.config import settings
from app.core.error_handling import register_exception_handlers
from app.db.seed import seed_data
from app.services.storage import StorageNotConfiguredError, get_storage_service
from app.services.dispatch_worker import start_dispatch_worker, stop_dispatch_worker
from app.services.redis_client import close_redis

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).resolve().parent / "static"
WEB_DIR = Path(__file__).resolve().parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "llm_initializing",
        extra={
            "base_url": settings.LLM_BASE_URL,
            "model": settings.LLM_MODEL,
        },
    )
    if not settings.LLM_API_KEY:
        logger.warning("LLM_API_KEY is not set. AI processing will fail!")
    await seed_data()
    try:
        get_storage_service()
    except StorageNotConfiguredError:
        logger.info("S3 storage is not configured; skipping startup storage initialization")
    except Exception:
        logger.exception("Failed to initialize S3 storage during startup")
    stop_event, task = await start_dispatch_worker()
    try:
        yield
    finally:
        await stop_dispatch_worker(stop_event, task)
        await close_redis()


app = FastAPI(
    title="Дармавоз.рф API",
    version=settings.WEB_VERSION,
    lifespan=lifespan,
)
register_exception_handlers(app)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    del request, exc
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Проверьте правильность заполнения полей"},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    del request
    if exc.status_code == status.HTTP_404_NOT_FOUND:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": "Ресурс не найден"},
            headers=exc.headers,
        )
    if exc.status_code == status.HTTP_405_METHOD_NOT_ALLOWED:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": "Метод запроса не поддерживается"},
            headers=exc.headers,
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    logger.exception(
        "unhandled_exception",
        extra={"path": str(request.url.path)},
        exc_info=exc,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Внутренняя ошибка сервера. Повторите попытку позже"},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=r"https?://([a-z0-9-]+\.)*nip\.io",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(auth.driver_auth_router, tags=["driver-auth"])
app.include_router(client_auth.router, prefix="/api/v1/auth", tags=["client-auth"])
app.include_router(supplier_auth.router, prefix="/api/v1/auth/supplier", tags=["supplier-auth"])
app.include_router(client_addresses.router, prefix="/api/v1")
app.include_router(client_orders.router, prefix="/api/v1", tags=["client-orders"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(admin_quarries.router, prefix="/api/v1/admin", tags=["admin-quarries"])
app.include_router(catalog.router, prefix="/api/v1/catalog", tags=["catalog"])
app.include_router(pickup_points.router, prefix="/api/v1/catalog/pickup-points", tags=["pickup-points"])
app.include_router(equipment.router, prefix="/api/v1", tags=["special-equipment"])
app.include_router(support.router, prefix="/api/v1", tags=["support"])
app.include_router(supplier_points.router, prefix="/api/v1/supplier", tags=["supplier-points"])
app.include_router(clients.router, prefix="/api/v1/clients", tags=["clients"])
app.include_router(drivers.router, prefix="/api/v1/drivers", tags=["drivers"])
app.include_router(logist_orders.router, prefix="/api/v1/logist", tags=["logist"])
app.include_router(driver_dispatch.router, prefix="/api/v1/driver", tags=["driver"])
app.include_router(media.router, prefix="/api/v1/media", tags=["media"])
app.include_router(geo.router, prefix="/api/v1/geo", tags=["geo"])
app.include_router(orders.router, prefix="/api/v1/orders", tags=["orders"])
app.include_router(system.router, prefix="/api/v1/system", tags=["system"])
app.include_router(telemetry.router, prefix="/api/v1", tags=["telemetry"])
app.include_router(webhooks.router, prefix="/api/v1/webhooks")


@app.get("/ping")
async def ping():
    return {"status": "ok"}


if STATIC_DIR.exists():
    @app.get("/demo", include_in_schema=False)
    async def demo_page():
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/demo", StaticFiles(directory=STATIC_DIR, html=True), name="static")


@app.get("/health")
async def health_check():
    return {
        "status": "online",
        "project": "Darmavoz Core API",
        "version": settings.WEB_VERSION,
        "message": "Server is running",
        "llm_configured": bool(settings.LLM_API_KEY),
    }


if WEB_DIR.exists():
    @app.get("/", include_in_schema=False)
    async def root_web():
        return FileResponse(WEB_DIR / "index.html")

    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
else:
    @app.get("/")
    async def root_json():
        return {
            "status": "online",
            "project": "Darmavoz Core API",
            "version": settings.WEB_VERSION,
            "message": "Server is running",
        }
