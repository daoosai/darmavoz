import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Role, User
from app.schemas.partner_auth import (
    PartnerRegisterRequest,
    PartnerRegistrationOut,
    PartnerSmsChallengeOut,
    PartnerVerifyCodeRequest,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token
from app.services.redis_client import get_redis
from app.services.sms_service import generate_otp_code, normalize_sms_phone, send_auth_sms_code, verify_sms_otp_code
from app.utils.phones import normalize_otp_phone, normalize_phone

router = APIRouter()
TTL_SECONDS = 300
CODE_PREFIX = "otp:water_septic_partner_register"
ROLE_NAME = "water_septic_partner"


def _code_key(phone: str) -> str:
    return f"{CODE_PREFIX}:{normalize_otp_phone(phone)}"


async def _get_partner_user(db: AsyncSession, phone: str) -> User | None:
    return await db.scalar(
        select(User).join(Role).where(User.username == phone, Role.name == ROLE_NAME)
    )


@router.post("/register", response_model=PartnerSmsChallengeOut, status_code=status.HTTP_200_OK)
async def register_water_septic_partner(
    payload: PartnerRegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> PartnerSmsChallengeOut:
    phone = normalize_phone(payload.phone)
    existing_user = await db.scalar(select(User).where(User.username == phone))
    existing_partner = await _get_partner_user(db, phone)
    if existing_user is not None and existing_partner is None:
        raise HTTPException(status_code=400, detail="PHONE_ALREADY_USED_BY_ANOTHER_ROLE")

    code = generate_otp_code()
    stored_code = await send_auth_sms_code(
        phone_number=normalize_sms_phone(phone),
        code=code,
        log_prefix="water_septic_partner_register_sms_auth",
    )
    redis = get_redis()
    await redis.setex(_code_key(phone), TTL_SECONDS, stored_code)
    return PartnerSmsChallengeOut(phone=phone)


@router.post("/register/verify", response_model=PartnerRegistrationOut)
async def verify_water_septic_partner_registration(
    payload: PartnerVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
) -> PartnerRegistrationOut:
    phone = normalize_phone(payload.phone)
    redis = get_redis()
    saved_code = await redis.get(_code_key(phone))
    if saved_code is None:
        raise HTTPException(status_code=400, detail="OTP_EXPIRED")
    if not verify_sms_otp_code(submitted_code=payload.code.strip(), stored_code=saved_code):
        raise HTTPException(status_code=400, detail="INVALID_OTP")

    user = await _get_partner_user(db, phone)
    if user is None:
        if await db.scalar(select(User.id).where(User.username == phone)) is not None:
            raise HTTPException(status_code=400, detail="PHONE_ALREADY_USED_BY_ANOTHER_ROLE")

        role = await db.scalar(select(Role).where(Role.name == ROLE_NAME))
        if role is None:
            role = Role(
                name=ROLE_NAME,
                description="Water points and septic services partner",
            )
            db.add(role)
            await db.flush()

        user = User(
            username=phone,
            hashed_password=get_password_hash(secrets.token_urlsafe(32)),
            role_id=role.id,
            is_active=True,
        )
        db.add(user)
        try:
            await db.commit()
        except IntegrityError as exc:
            await db.rollback()
            conflicting_user = await db.scalar(select(User).where(User.username == phone))
            conflicting_partner = await _get_partner_user(db, phone)
            if conflicting_user is not None and conflicting_partner is None:
                raise HTTPException(status_code=400, detail="PHONE_ALREADY_USED_BY_ANOTHER_ROLE") from exc
            raise HTTPException(status_code=400, detail="WATER_SEPTIC_PARTNER_PHONE_ALREADY_EXISTS") from exc
    elif not user.is_active:
        raise HTTPException(status_code=403, detail="WATER_SEPTIC_PARTNER_ACCOUNT_DISABLED")

    await redis.delete(_code_key(phone))
    token = create_access_token(
        data={"sub": user.username, "role": ROLE_NAME, "auth_version": user.auth_version}
    )
    return PartnerRegistrationOut(access_token=token, role=ROLE_NAME)
