from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Client, Order, User
from app.schemas.client import (
    ClientCreate,
    ClientFcmTokenIn,
    ClientFcmTokenOut,
    ClientProfileResponse,
    ClientProfileUpdate,
    ClientResponse,
)
from app.schemas.order import OrderOut
from app.security.auth import get_current_client, get_current_logist_user
from app.services.dispatch_service import list_orders_for_client

router = APIRouter()


def split_client_name(name: str | None) -> tuple[str, str | None]:
    parts = [part for part in (name or "").strip().split() if part]
    if not parts:
        return "", None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


def build_client_profile_response(client: Client) -> ClientProfileResponse:
    first_name, last_name = split_client_name(client.name)
    return ClientProfileResponse(
        id=client.id,
        first_name=first_name,
        last_name=last_name,
        name=client.name,
        phone=client.phone,
        created_at=client.created_at,
    )


@router.post("/", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
async def create_client(
    payload: ClientCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    existing = await db.execute(select(Client).where(Client.phone == payload.phone))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Client with this phone already exists",
        )

    client = Client(name=payload.name, phone=payload.phone)
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return client


@router.get("/", response_model=List[ClientResponse])
async def list_clients(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    result = await db.execute(select(Client).order_by(Client.name.asc()))
    return result.scalars().all()


@router.get("/me", response_model=ClientProfileResponse)
async def get_my_profile(current_client: Client = Depends(get_current_client)):
    return build_client_profile_response(current_client)


@router.patch("/me", response_model=ClientProfileResponse)
async def update_my_profile(
    payload: ClientProfileUpdate,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
):
    current_first_name, current_last_name = split_client_name(current_client.name)
    first_name = payload.first_name if payload.first_name is not None else current_first_name
    last_name = payload.last_name if payload.last_name is not None else current_last_name

    if not first_name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="first_name is required")

    current_client.name = " ".join(part for part in [first_name, last_name] if part)
    await db.commit()
    await db.refresh(current_client)
    return build_client_profile_response(current_client)


@router.post("/me/fcm-token", response_model=ClientFcmTokenOut)
async def save_my_fcm_token(
    payload: ClientFcmTokenIn,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> ClientFcmTokenOut:
    current_client.fcm_token = payload.token.strip()
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=current_client.fcm_token)


@router.delete("/me/fcm-token", response_model=ClientFcmTokenOut)
async def delete_my_fcm_token(
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> ClientFcmTokenOut:
    current_client.fcm_token = None
    await db.commit()
    return ClientFcmTokenOut(ok=True, token=None)


@router.get("/me/orders", response_model=list[OrderOut])
async def get_my_orders(
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    return await list_orders_for_client(db, current_client.id)
