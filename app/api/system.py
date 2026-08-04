from fastapi import APIRouter

from app.core.config import settings
from app.schemas.system import SystemVersionOut
from app.schemas.placement import PlacementPolicyOut

router = APIRouter()


@router.get("/version", response_model=SystemVersionOut)
async def get_system_version() -> SystemVersionOut:
    return SystemVersionOut(
        android_version=settings.ANDROID_VERSION,
        ios_version=settings.IOS_VERSION,
        web_version=settings.WEB_VERSION,
        download_url=settings.APK_DOWNLOAD_URL,
        force_update=settings.APK_FORCE_UPDATE,
    )


@router.get("/placement-policy", response_model=PlacementPolicyOut)
async def get_placement_policy() -> PlacementPolicyOut:
    return PlacementPolicyOut(
        trial_days=settings.PLACEMENT_TRIAL_DAYS,
        extension_days=settings.PLACEMENT_EXTENSION_DAYS,
        confirmation_interval_days=settings.PLACEMENT_CONFIRMATION_INTERVAL_DAYS,
        confirmation_grace_days=settings.PLACEMENT_CONFIRMATION_GRACE_DAYS,
    )
