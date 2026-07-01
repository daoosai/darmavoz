import logging
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
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
    return f"{secrets.randbelow(10000):04d}"


async def _send_sms_ru_code(*, phone_number: str, code: str, client_ip: str | None = None) -> None:
    api_key = settings.SMS_RU_API_ID
    if not api_key:
        logger.error("sms_ru_not_configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SMS service is not configured",
        )

    payload = {
        "api_id": api_key,
        "to": phone_number,
        "msg": f"Your Darmavoz code: {code}",
        "json": 1,
    }
    if client_ip:
        payload["ip"] = client_ip

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post("https://sms.ru/sms/send", params=payload)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("sms_ru_request_failed phone=%s", phone_number)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMS service is temporarily unavailable",
        ) from exc

    try:
        response_data = response.json()
    except ValueError as exc:
        logger.error("sms_ru_invalid_response phone=%s body=%s", phone_number, response.text[:500])
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMS service is temporarily unavailable",
        ) from exc

    sms_info = response_data.get("sms", {}).get(phone_number)
    if response_data.get("status") != "OK" or not isinstance(sms_info, dict) or sms_info.get("status") != "OK":
        logger.error("sms_ru_send_error phone=%s response=%s", phone_number, response_data)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to send SMS code",
        )


def _sms_ru_phone(phone_number: str) -> str:
    sms_phone = phone_number.replace("+", "").strip()
    if len(sms_phone) == 10:
        sms_phone = "7" + sms_phone
    elif len(sms_phone) == 11 and sms_phone.startswith("8"):
        sms_phone = "7" + sms_phone[1:]
    return sms_phone


def _default_client_name(phone_number: str) -> str:
    return f"Клиент {phone_number[-4:]}"


@router.post("/send-code", response_model=ClientSendCodeResponse)
async def send_code(
    payload: ClientSendCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = _normalize_phone_number(payload.phone_number)
    sms_phone = _sms_ru_phone(normalized_phone)
    code = _generate_otp_code()
    client_ip = request.client.host if request.client is not None else None

    await _send_sms_ru_code(phone_number=sms_phone, code=code, client_ip=client_ip)

    client = await db.scalar(select(Client).where(Client.phone == normalized_phone))
    is_new_user = client is None
    if client is None:
        client = Client(name=_default_client_name(normalized_phone), phone=normalized_phone, email=None)
        db.add(client)
        await db.commit()
        await db.refresh(client)

    await get_redis().setex(_code_key(normalized_phone), CLIENT_CODE_TTL_SECONDS, code)

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
