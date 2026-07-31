import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import User
from app.schemas.client import ClientFcmTokenIn, ClientFcmTokenOut
from app.schemas.supplier import SupplierProfileOut, SupplierProfileUpdate
from app.security.auth import get_current_equipment_owner_user
from app.services.fcm_tokens import detach_fcm_token_from_other_entities

router = APIRouter()
logger = logging.getLogger(__name__)


def _equipment_owner_phone_value(user: User) -> str | None:
    return user.username if "@" not in (user.username or "") else None


@router.get("/me", response_model=SupplierProfileOut)
async def get_equipment_owner_profile(
    current_user: User = Depends(get_current_equipment_owner_user),
) -> SupplierProfileOut:
    return SupplierProfileOut(
        phone=_equipment_owner_phone_value(current_user),
        email=current_user.email,
        display_name=current_user.display_name,
    )


@router.patch("/me", response_model=SupplierProfileOut)
async def update_equipment_owner_profile(
    payload: SupplierProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_equipment_owner_user),
) -> SupplierProfileOut:
    current_user.display_name = payload.display_name
    await db.commit()
    await db.refresh(current_user)
    return SupplierProfileOut(
        phone=_equipment_owner_phone_value(current_user),
        email=current_user.email,
        display_name=current_user.display_name,
    )


@router.post("/me/fcm-token", response_model=ClientFcmTokenOut)
async def save_equipment_owner_fcm_token(
    payload: ClientFcmTokenIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_equipment_owner_user),
) -> ClientFcmTokenOut:
    normalized_token = payload.token.strip()
    logger.info(
        "equipment_owner_fcm_token_save_requested",
        extra={
            "user_id": str(current_user.id),
            "token_prefix": normalized_token[:24],
        },
    )
    await detach_fcm_token_from_other_entities(
        db,
        normalized_token,
        keep_user_id=current_user.id,
    )
    current_user.fcm_token = normalized_token
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=current_user.fcm_token)


@router.delete("/me/fcm-token", response_model=ClientFcmTokenOut)
async def delete_equipment_owner_fcm_token(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_equipment_owner_user),
) -> ClientFcmTokenOut:
    logger.info(
        "equipment_owner_fcm_token_deleted",
        extra={"user_id": str(current_user.id)},
    )
    current_user.fcm_token = None
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=None)
