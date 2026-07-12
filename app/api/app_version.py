from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def get_app_version():
    return {
        "latest_version": settings.ANDROID_VERSION,
        "android_version": settings.ANDROID_VERSION,
        "download_url": settings.APK_DOWNLOAD_URL,
        "force_update": settings.APK_FORCE_UPDATE,
    }
