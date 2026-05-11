from fastapi import APIRouter

router = APIRouter()

@router.get("/")
async def get_app_version():
    return {
        "latest_version": "1.0.1",
        "download_url": "https://darmovoz.ru/app.apk",
        "force_update": False
    }
