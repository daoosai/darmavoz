from fastapi import APIRouter

from app.core.config import settings
from app.schemas.system import SystemVersionOut

router = APIRouter()


@router.get("/version", response_model=SystemVersionOut)
async def get_system_version() -> SystemVersionOut:
    return SystemVersionOut(
        android_version=settings.ANDROID_VERSION,
        download_url=settings.APK_DOWNLOAD_URL,
        force_update=settings.APK_FORCE_UPDATE,
    )
