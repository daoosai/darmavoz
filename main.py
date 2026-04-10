from fastapi import FastAPI

app = FastAPI(title="Darmavoz API")

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
