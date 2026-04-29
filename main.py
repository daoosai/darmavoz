import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import admin, auth, clients, drivers, webhooks
from app.core.config import settings
from app.db.seed import seed_data

logger = logging.getLogger(__name__)

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
    # Запускаем посев данных
    await seed_data()
    yield

app = FastAPI(title="Дармавоз.рф API", lifespan=lifespan)

# Include routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(clients.router, prefix="/api/v1/clients", tags=["clients"])
app.include_router(drivers.router, prefix="/api/v1/drivers", tags=["drivers"])
app.include_router(webhooks.router, prefix="/api/v1/webhooks")

@app.get("/ping")
async def ping():
    return {"status": "ok"}

@app.get("/")
async def root():
    return {
        "status": "online",
        "project": "Darmavoz Core API",
        "version": "0.1.0",
        "message": "Server is running"
    }

@app.get("/health")
async def health_check():
    return {
        "status": "online",
        "project": "Darmavoz Core API",
        "version": "0.1.0",
        "message": "Server is running",
        "llm_configured": bool(settings.LLM_API_KEY),
    }
