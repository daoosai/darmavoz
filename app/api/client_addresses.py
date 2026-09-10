from app.services.cities import resolve_city, ensure_same_city
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Client, ClientAddress
from app.schemas.client import ClientAddressCreate, ClientAddressOut, ClientAddressUpdate
from app.security.auth import get_current_client

router = APIRouter(prefix="/client/addresses", tags=["client-addresses"])


async def _get_client_address_or_404(
    db: AsyncSession,
    *,
    address_id: UUID,
    client_id: UUID,
) -> ClientAddress:
    result = await db.execute(
        select(ClientAddress).where(
            ClientAddress.id == address_id,
            ClientAddress.client_id == client_id,
        )
    )
    address = result.scalar_one_or_none()
    if address is None:
        raise HTTPException(status_code=404, detail="Address not found")
    return address


async def _set_default_address(db: AsyncSession, *, current_client_id: UUID, address: ClientAddress) -> ClientAddress:
    existing_addresses = list(
        (
            await db.execute(
                select(ClientAddress).where(ClientAddress.client_id == current_client_id, ClientAddress.city_id == address.city_id)
            )
        ).scalars().all()
    )
    for existing in existing_addresses:
        existing.is_default = existing.id == address.id
    await db.commit()
    await db.refresh(address)
    return address


@router.get("", response_model=list[ClientAddressOut])
@router.get("/", response_model=list[ClientAddressOut], include_in_schema=False)
async def list_client_addresses(
    current_client: Client = Depends(get_current_client),
    city_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[ClientAddress]:
    query = select(ClientAddress).where(ClientAddress.client_id == current_client.id)
    if city_id is not None:
        city = await resolve_city(db, city_id)
        query = query.where(ClientAddress.city_id == city.id)
    result = await db.execute(query.order_by(ClientAddress.is_default.desc(), ClientAddress.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=ClientAddressOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ClientAddressOut, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_client_address(
    payload: ClientAddressCreate,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> ClientAddress:
    city = await resolve_city(db, payload.city_id)
    existing_addresses = list(
        (
            await db.execute(
                select(ClientAddress).where(ClientAddress.client_id == current_client.id, ClientAddress.city_id == city.id)
            )
        ).scalars().all()
    )

    should_be_default = payload.is_default if payload.is_default is not None else len(existing_addresses) == 0
    if should_be_default:
        for existing in existing_addresses:
            existing.is_default = False

    address = ClientAddress(
        city_id=city.id,
        client_id=current_client.id,
        full_address=payload.full_address,
        comment=payload.comment,
        lat=payload.lat,
        lon=payload.lon,
        is_default=should_be_default,
    )
    db.add(address)
    await db.commit()
    await db.refresh(address)
    return address


@router.put("/{address_id}", response_model=ClientAddressOut)
async def update_client_address(
    address_id: UUID,
    payload: ClientAddressUpdate,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> ClientAddress:
    city = await resolve_city(db, payload.city_id)
    address = await _get_client_address_or_404(
        db,
        address_id=address_id,
        client_id=current_client.id,
    )
    ensure_same_city(city.id, address)
    address.full_address = payload.full_address
    address.comment = payload.comment
    address.lat = payload.lat
    address.lon = payload.lon
    await db.commit()
    await db.refresh(address)
    return address


@router.patch("/{address_id}/default", response_model=ClientAddressOut)
async def set_default_client_address(
    address_id: UUID,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> ClientAddress:
    address = await _get_client_address_or_404(
        db,
        address_id=address_id,
        client_id=current_client.id,
    )
    if address.is_default:
        return address
    return await _set_default_address(db, current_client_id=current_client.id, address=address)


@router.delete("/{address_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_client_address(
    address_id: UUID,
    current_client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
) -> None:
    address = await _get_client_address_or_404(
        db,
        address_id=address_id,
        client_id=current_client.id,
    )
    was_default = address.is_default
    await db.delete(address)
    await db.flush()

    if was_default:
        next_address = await db.scalar(
            select(ClientAddress)
            .where(ClientAddress.client_id == current_client.id, ClientAddress.city_id == address.city_id)
            .order_by(ClientAddress.created_at.asc())
            .limit(1)
        )
        if next_address is not None:
            next_address.is_default = True

    await db.commit()
