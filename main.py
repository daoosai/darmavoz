from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.api import auth, admin
from app.db.seed import seed_data

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Запускаем посев данных
    await seed_data()
    yield

app = FastAPI(title="Дармавоз.рф API", lifespan=lifespan)

# Include routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])

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
