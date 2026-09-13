import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.models.models import Client
from app.schemas.client import (
    ClientAuthResponse,
    ClientRegister,
    ClientSendCodeRequest,
    ClientSendCodeResponse,
    ClientVerifyCodeRequest,
)
from app.security.jwt import create_access_token
from app.services.redis_client import get_redis
from app.services.sms_service import (
    enforce_sms_rate_limit,
    generate_otp_code,
    normalize_sms_phone,
    send_auth_sms_code,
    validate_sms_otp,
)
from app.utils.phones import normalize_otp_phone, normalize_phone

router = APIRouter(prefix="/client")
logger = logging.getLogger("uvicorn.error")

CLIENT_CODE_TTL_SECONDS = 300
CLIENT_REGISTRATION_PREFIX = "pending:client_registration"


def _normalize_email(email: str | None) -> str | None:
    if email is None:
        return None
    value = email.strip().lower()
    return value or None


def _normalize_phone_number(phone_number: str) -> str:
    normalized_phone = normalize_phone(phone_number)
    digits = "".join(ch for ch in normalized_phone if ch.isdigit())
    if not digits:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="phone_number is required")
    return f"+{digits}"


def _code_key(phone_number: str) -> str:
    return f"otp:client:{normalize_otp_phone(phone_number)}"


def _registration_key(phone_number: str) -> str:
    return f"{CLIENT_REGISTRATION_PREFIX}:{normalize_otp_phone(phone_number)}"


def _default_client_name(phone_number: str) -> str:
    return f"Клиент {phone_number[-4:]}"


@router.post("/send-code", response_model=ClientSendCodeResponse)
async def send_code(
    payload: ClientSendCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = _normalize_phone_number(payload.phone_number)
    sms_phone = normalize_sms_phone(normalized_phone)
    redis = get_redis()
    await enforce_sms_rate_limit(redis, normalized_phone)
    code = generate_otp_code()
    code = await send_auth_sms_code(phone_number=sms_phone, code=code, log_prefix="client_sms_auth")

    client = await db.scalar(select(Client).where(Client.phone == normalized_phone))
    is_new_user = client is None
    await redis.setex(_code_key(normalized_phone), CLIENT_CODE_TTL_SECONDS, code)

    logger.info(
        "client_auth_code_generated phone=%s ttl_seconds=%s",
        normalized_phone,
        CLIENT_CODE_TTL_SECONDS,
    )

    return ClientSendCodeResponse(is_new_user=is_new_user)


@router.post("/register", response_model=ClientSendCodeResponse, status_code=status.HTTP_201_CREATED)
async def register_client(
    payload: ClientRegister,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = _normalize_phone_number(payload.phone_number)
    normalized_email = _normalize_email(payload.email)

    conditions = [Client.phone == normalized_phone]
    if normalized_email is not None:
        conditions.append(func.lower(Client.email) == normalized_email)

    existing_client = await db.scalar(
        select(Client.id).where(or_(*conditions))
    )
    if existing_client is not None:
        existing_record = await db.get(Client, existing_client)
        if existing_record and existing_record.phone == normalized_phone:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Client with this phone already exists")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Client with this email already exists")

    redis = get_redis()
    await enforce_sms_rate_limit(redis, normalized_phone)
    code = await send_auth_sms_code(
        phone_number=normalize_sms_phone(normalized_phone),
        code=generate_otp_code(),
        log_prefix="client_registration_sms_auth",
    )
    await redis.setex(_code_key(normalized_phone), CLIENT_CODE_TTL_SECONDS, code)
    await redis.setex(
        _registration_key(normalized_phone),
        CLIENT_CODE_TTL_SECONDS,
        json.dumps(
            {
                "name": payload.name.strip() or _default_client_name(normalized_phone),
                "email": normalized_email,
            }
        ),
    )

    return ClientSendCodeResponse(is_new_user=True)


@router.post("/verify-code", response_model=ClientAuthResponse)
async def verify_code(
    payload: ClientVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = _normalize_phone_number(payload.phone_number)
    code = payload.code.strip()
    redis = get_redis()
    saved_code = await redis.get(_code_key(normalized_phone))

    if saved_code is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код истек или не запрашивался")
    if not await validate_sms_otp(
        redis=redis,
        phone_number=normalized_phone,
        otp_key=_code_key(normalized_phone),
        submitted_code=code,
        stored_code=saved_code,
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный код")

    client = await db.scalar(select(Client).where(Client.phone == normalized_phone))
    if client is None:
        registration_raw = await redis.get(_registration_key(normalized_phone))
        try:
            registration = json.loads(registration_raw) if registration_raw else {}
        except (TypeError, json.JSONDecodeError):
            registration = {}
        registration_email = _normalize_email(registration.get("email"))
        if registration_email is not None:
            existing_email_client = await db.scalar(
                select(Client.id).where(func.lower(Client.email) == registration_email)
            )
            if existing_email_client is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Client with this email already exists")
        client = Client(
            name=str(registration.get("name") or _default_client_name(normalized_phone)),
            phone=normalized_phone,
            email=registration_email,
        )
        db.add(client)
        await db.commit()
        await db.refresh(client)

    access_token = create_access_token(
        data={
            "sub": normalized_phone,
            "role": "client",
            "client_id": str(client.id),
            "auth_version": client.auth_version,
        }
    )
    await redis.delete(_code_key(normalized_phone))
    await redis.delete(_registration_key(normalized_phone))

    return ClientAuthResponse(
        access_token=access_token,
        role="client",
        client_id=client.id,
    )
