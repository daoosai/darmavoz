from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.api import auth, admin
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.db.seed import seed_data

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run seed data
    async with AsyncSessionLocal() as session:
        await seed_data(session)
    yield

app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

# Include routers
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["auth"])
app.include_router(admin.router, prefix=f"{settings.API_V1_STR}/admin", tags=["admin"])

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
        "message": "Server is running"
    }
