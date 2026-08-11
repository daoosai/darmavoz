from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import User
from app.schemas.client import ClientFcmTokenIn, ClientFcmTokenOut
from app.schemas.supplier import SupplierProfileOut, SupplierProfileUpdate
from app.security.auth import get_current_water_septic_partner_user
from app.services.fcm_tokens import detach_fcm_token_from_other_entities

router = APIRouter()


def _partner_phone_value(user: User) -> str | None:
    return user.username if "@" not in (user.username or "") else None


def _profile_out(user: User) -> SupplierProfileOut:
    return SupplierProfileOut(
        phone=_partner_phone_value(user),
        email=user.email,
        display_name=user.display_name,
    )


@router.get("/me", response_model=SupplierProfileOut)
async def get_water_septic_partner_profile(
    current_user: User = Depends(get_current_water_septic_partner_user),
) -> SupplierProfileOut:
    return _profile_out(current_user)


@router.patch("/me", response_model=SupplierProfileOut)
async def update_water_septic_partner_profile(
    payload: SupplierProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_water_septic_partner_user),
) -> SupplierProfileOut:
    current_user.display_name = payload.display_name
    await db.commit()
    await db.refresh(current_user)
    return _profile_out(current_user)


@router.post("/me/fcm-token", response_model=ClientFcmTokenOut)
async def save_water_septic_partner_fcm_token(
    payload: ClientFcmTokenIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_water_septic_partner_user),
) -> ClientFcmTokenOut:
    normalized_token = payload.token.strip()
    await detach_fcm_token_from_other_entities(
        db,
        normalized_token,
        keep_user_id=current_user.id,
    )
    current_user.fcm_token = normalized_token
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=current_user.fcm_token)


@router.delete("/me/fcm-token", response_model=ClientFcmTokenOut)
async def delete_water_septic_partner_fcm_token(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_water_septic_partner_user),
) -> ClientFcmTokenOut:
    current_user.fcm_token = None
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=None)
