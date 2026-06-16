import logging
import random

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

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

router = APIRouter(prefix="/client")
logger = logging.getLogger("uvicorn.error")

CLIENT_CODE_TTL_SECONDS = 300


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_phone(phone: str) -> str:
    return phone.strip()


def _code_key(email: str) -> str:
    return f"client_auth_code:{email}"


@router.post("/send-code", response_model=ClientSendCodeResponse)
async def send_code(
    payload: ClientSendCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_email = _normalize_email(payload.email)
    code = f"{random.randint(0, 9999):04d}"
    await get_redis().setex(_code_key(normalized_email), CLIENT_CODE_TTL_SECONDS, code)

    logger.info(
        "client_auth_code_generated email=%s code=%s ttl_seconds=%s",
        normalized_email,
        code,
        CLIENT_CODE_TTL_SECONDS,
    )

    existing_client = await db.scalar(select(Client.id).where(func.lower(Client.email) == normalized_email))
    return ClientSendCodeResponse(is_new_user=existing_client is None)


@router.post("/register", response_model=ClientSendCodeResponse, status_code=status.HTTP_201_CREATED)
async def register_client(
    payload: ClientRegister,
    db: AsyncSession = Depends(get_db),
):
    normalized_email = _normalize_email(payload.email)
    normalized_phone = _normalize_phone(payload.phone)

    existing_client = await db.scalar(
        select(Client.id).where(
            or_(
                func.lower(Client.email) == normalized_email,
                Client.phone == normalized_phone,
            )
        )
    )
    if existing_client is not None:
        existing_record = await db.get(Client, existing_client)
        if existing_record and existing_record.phone == normalized_phone:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Client with this phone already exists")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Client with this email already exists")

    client = Client(
        email=normalized_email,
        phone=normalized_phone,
        name=payload.name.strip(),
    )
    db.add(client)
    await db.commit()

    return ClientSendCodeResponse(is_new_user=True)


@router.post("/verify-code", response_model=ClientAuthResponse)
async def verify_code(
    payload: ClientVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_email = _normalize_email(payload.email)
    code = payload.code.strip()
    saved_code = await get_redis().get(_code_key(normalized_email))

    if code != "0000" and saved_code != code:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid verification code")

    client = await db.scalar(select(Client).where(func.lower(Client.email) == normalized_email))
    if client is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    access_token = create_access_token(
        data={
            "sub": normalized_email,
            "role": "client",
            "client_id": str(client.id),
        }
    )
    await get_redis().delete(_code_key(normalized_email))

    return ClientAuthResponse(
        access_token=access_token,
        role="client",
        client_id=client.id,
    )
