import logging
import random

import httpx

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
from app.utils.phones import normalize_phone

router = APIRouter(prefix="/client")
logger = logging.getLogger("uvicorn.error")

CLIENT_CODE_TTL_SECONDS = 300
SMS_RU_URL = "https://sms.ru/sms/send"


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
    return f"otp:client:{phone_number}"


def _generate_otp_code() -> str:
    return str(random.randint(1000, 9999))


def _sms_ru_phone(phone_number: str) -> str:
    return phone_number.lstrip("+")


def _default_client_name(phone_number: str) -> str:
    return f"Клиент {phone_number[-4:]}"


@router.post("/send-code", response_model=ClientSendCodeResponse)
async def send_code(
    payload: ClientSendCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = _normalize_phone_number(payload.phone_number)
    code = _generate_otp_code()

    client = await db.scalar(select(Client).where(Client.phone == normalized_phone))
    is_new_user = client is None
    if client is None:
        client = Client(name=_default_client_name(normalized_phone), phone=normalized_phone, email=None)
        db.add(client)
        await db.commit()
        await db.refresh(client)

    if not settings.SMS_RU_API_ID:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="SMS service is not configured")

    await get_redis().setex(_code_key(normalized_phone), CLIENT_CODE_TTL_SECONDS, code)

    sms_payload = {
        "api_id": settings.SMS_RU_API_ID,
        "to": _sms_ru_phone(normalized_phone),
        "msg": f"{code} - ваш код для входа в Дармавоз",
        "json": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.post(SMS_RU_URL, data=sms_payload)
            response.raise_for_status()
            response_data = response.json()
    except (httpx.HTTPError, ValueError):
        await get_redis().delete(_code_key(normalized_phone))
        logger.exception("sms_ru_send_failed phone=%s", normalized_phone)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Не удалось отправить код")

    logger.info("Отправка СМС на %s, статус: %s", normalized_phone, response_data)

    if str(response_data.get("status")) != "OK":
        await get_redis().delete(_code_key(normalized_phone))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Не удалось отправить код")

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

    client = Client(
        email=normalized_email,
        phone=normalized_phone,
        name=payload.name.strip() or _default_client_name(normalized_phone),
    )
    db.add(client)
    await db.commit()

    return ClientSendCodeResponse(is_new_user=True)


@router.post("/verify-code", response_model=ClientAuthResponse)
async def verify_code(
    payload: ClientVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = _normalize_phone_number(payload.phone_number)
    code = payload.code.strip()
    saved_code = await get_redis().get(_code_key(normalized_phone))

    if saved_code is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код истек или не запрашивался")
    if code != saved_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный код")

    client = await db.scalar(select(Client).where(Client.phone == normalized_phone))
    if client is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    access_token = create_access_token(
        data={
            "sub": normalized_phone,
            "role": "client",
            "client_id": str(client.id),
        }
    )
    await get_redis().delete(_code_key(normalized_phone))

    return ClientAuthResponse(
        access_token=access_token,
        role="client",
        client_id=client.id,
    )
