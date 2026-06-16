from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Client, Order, User
from app.schemas.client import ClientCreate, ClientResponse
from app.schemas.order import OrderOut
from app.security.auth import get_current_client, get_current_logist_user
from app.services.dispatch_service import list_orders_for_client

router = APIRouter()


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


@router.get("/me", response_model=ClientResponse)
async def get_my_profile(current_client: Client = Depends(get_current_client)):
    return current_client


@router.get("/me/orders", response_model=list[OrderOut])
async def get_my_orders(
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    return await list_orders_for_client(db, current_client.id)
