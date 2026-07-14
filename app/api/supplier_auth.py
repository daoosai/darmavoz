import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import ModerationStatus, Quarry, Role, User
from app.schemas.quarry import (
    SupplierRegisterRequest,
    SupplierRegistrationOut,
    SupplierSmsChallengeOut,
    SupplierVerifyCodeRequest,
)
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token
from app.services.pickup_points import (
    default_delivery_option_ids,
    default_min_delivery_price,
    pickup_point_payload,
    sync_delivery_options,
    sync_material_offers,
)
from app.services.redis_client import get_redis
from app.services.sms_service import generate_otp_code, normalize_sms_phone, send_auth_sms_code
from app.utils.phones import normalize_phone

router = APIRouter()
TTL_SECONDS = 300
CODE_PREFIX = "otp:supplier_register"
PENDING_PREFIX = "otp:supplier_register_pending"


@router.post("/register", response_model=SupplierSmsChallengeOut, status_code=status.HTTP_202_ACCEPTED)
async def register_supplier(
    payload: SupplierRegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> SupplierSmsChallengeOut:
    phone = normalize_phone(payload.phone)
    if await db.scalar(select(User.id).where(User.username == phone)) is not None:
        raise HTTPException(status_code=409, detail="SUPPLIER_PHONE_ALREADY_EXISTS")
    code = generate_otp_code()
    stored_code = await send_auth_sms_code(
        phone_number=normalize_sms_phone(phone),
        code=code,
        log_prefix="supplier_register_smsc",
    )
    redis = get_redis()
    await redis.setex(f"{CODE_PREFIX}:{phone}", TTL_SECONDS, stored_code)
    await redis.setex(
        f"{PENDING_PREFIX}:{phone}",
        TTL_SECONDS,
        payload.model_copy(update={"phone": phone}).model_dump_json(),
    )
    return SupplierSmsChallengeOut(phone=phone)


@router.post("/register/verify", response_model=SupplierRegistrationOut)
async def verify_supplier_registration(
    payload: SupplierVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    phone = normalize_phone(payload.phone)
    redis = get_redis()
    saved_code = await redis.get(f"{CODE_PREFIX}:{phone}")
    raw_payload = await redis.get(f"{PENDING_PREFIX}:{phone}")
    if saved_code is None or raw_payload is None:
        raise HTTPException(status_code=400, detail="OTP_EXPIRED")
    if payload.code.strip() != saved_code:
        raise HTTPException(status_code=400, detail="INVALID_OTP")
    try:
        registration = SupplierRegisterRequest.model_validate(json.loads(raw_payload))
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="INVALID_REGISTRATION_PAYLOAD") from exc
    if await db.scalar(select(User.id).where(User.username == phone)) is not None:
        raise HTTPException(status_code=409, detail="SUPPLIER_PHONE_ALREADY_EXISTS")

    role = await db.scalar(select(Role).where(Role.name == "supplier"))
    if role is None:
        role = Role(name="supplier", description="Pickup point owner")
        db.add(role)
        await db.flush()
    user = User(
        username=phone,
        hashed_password=get_password_hash(registration.password),
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    point = Quarry(
        name=registration.name,
        short_name=registration.short_name,
        point_type=registration.point_type,
        address=registration.address,
        description=registration.description,
        lat=registration.lat,
        lon=registration.lon,
        min_delivery_price=default_min_delivery_price(registration.point_type),
        owner_user_id=user.id,
        moderation_status=ModerationStatus.incomplete.value,
        is_active=True,
    )
    db.add(point)
    await db.flush()
    await sync_material_offers(db, quarry_id=point.id, offers=registration.material_offers)
    await sync_delivery_options(
        db,
        quarry_id=point.id,
        delivery_option_ids=await default_delivery_option_ids(db, point.point_type),
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="SUPPLIER_PHONE_ALREADY_EXISTS") from exc
    await db.refresh(point)
    await redis.delete(f"{CODE_PREFIX}:{phone}")
    await redis.delete(f"{PENDING_PREFIX}:{phone}")
    token = create_access_token(data={"sub": user.username, "role": role.name})
    return {
        "access_token": token,
        "role": role.name,
        "point_id": point.id,
        "point": await pickup_point_payload(db, point),
    }
