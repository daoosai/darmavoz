import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Role, User
from app.schemas.quarry import (
    SupplierRegisterRequest,
    SupplierRegistrationOut,
    SupplierSmsChallengeOut,
    SupplierVerifyCodeRequest,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token
from app.services.redis_client import get_redis
from app.services.sms_service import generate_otp_code, normalize_sms_phone, send_auth_sms_code
from app.utils.phones import normalize_phone

router = APIRouter()
TTL_SECONDS = 300
CODE_PREFIX = "otp:supplier_register"


async def _get_supplier_user(db: AsyncSession, phone: str) -> User | None:
    return await db.scalar(
        select(User).join(Role).where(User.username == phone, Role.name == "supplier")
    )


@router.post("/register", response_model=SupplierSmsChallengeOut, status_code=status.HTTP_200_OK)
async def register_supplier(
    payload: SupplierRegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> SupplierSmsChallengeOut:
    phone = normalize_phone(payload.phone)
    existing_user = await db.scalar(select(User).where(User.username == phone))
    existing_supplier = await _get_supplier_user(db, phone)
    if existing_user is not None and existing_supplier is None:
        raise HTTPException(status_code=409, detail="PHONE_ALREADY_USED_BY_ANOTHER_ROLE")
    code = generate_otp_code()
    stored_code = await send_auth_sms_code(
        phone_number=normalize_sms_phone(phone),
        code=code,
        log_prefix="supplier_register_sms_auth",
    )
    redis = get_redis()
    await redis.setex(f"{CODE_PREFIX}:{phone}", TTL_SECONDS, stored_code)
    return SupplierSmsChallengeOut(phone=phone)


@router.post("/register/verify", response_model=SupplierRegistrationOut)
async def verify_supplier_registration(
    payload: SupplierVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    phone = normalize_phone(payload.phone)
    redis = get_redis()
    saved_code = await redis.get(f"{CODE_PREFIX}:{phone}")
    if saved_code is None:
        raise HTTPException(status_code=400, detail="OTP_EXPIRED")
    if payload.code.strip() != saved_code:
        raise HTTPException(status_code=400, detail="INVALID_OTP")
    user = await _get_supplier_user(db, phone)
    if user is None:
        if await db.scalar(select(User.id).where(User.username == phone)) is not None:
            raise HTTPException(status_code=409, detail="PHONE_ALREADY_USED_BY_ANOTHER_ROLE")
        role = await db.scalar(select(Role).where(Role.name == "supplier"))
        if role is None:
            role = Role(name="supplier", description="Pickup point owner")
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
            raise HTTPException(status_code=409, detail="SUPPLIER_PHONE_ALREADY_EXISTS") from exc
    elif not user.is_active:
        raise HTTPException(status_code=403, detail="SUPPLIER_ACCOUNT_DISABLED")

    await redis.delete(f"{CODE_PREFIX}:{phone}")
    token = create_access_token(data={"sub": user.username, "role": "supplier"})
    return {
        "access_token": token,
        "role": "supplier",
    }
