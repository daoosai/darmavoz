from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()

@router.get("", include_in_schema=False)
@router.get("/")
async def get_app_version():
    return {
        "latest_version": "2.4.5",
        "download_url": "https://test.darmavoz.ru/static/darmavoz-test.apk",
        "force_update": False
    }
