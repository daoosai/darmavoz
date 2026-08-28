import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import CartItem, CrmStatus, Material, Quarry, quarry_materials
from app.schemas.catalog import CartItemCreate, CartItemUpdate, CartItemOut
from app.services.pickup_points import is_pickup_point_publicly_available

router = APIRouter()


@router.get("/", response_model=List[CartItemOut])
async def get_cart_items(
    session_key: str = Header(alias="session_key"),
    db: AsyncSession = Depends(get_db)
):
    """Returns a list of cart items for a given session_key."""
    stmt = (
        select(CartItem)
        .outerjoin(Quarry, CartItem.quarry_id == Quarry.id)
        .where(CartItem.session_key == session_key)
        .where(
            or_(
                CartItem.quarry_id.is_(None),
                Quarry.crm_status == CrmStatus.active.value,
            )
        )
        .options(selectinload(CartItem.material), selectinload(CartItem.quarry))
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/items", response_model=CartItemOut)
async def add_cart_item(
    item: CartItemCreate,
    session_key: str = Header(alias="session_key"),
    db: AsyncSession = Depends(get_db)
):
    """Adds a material to the cart or updates its volume if it already exists."""
    # Check if material exists and is active
    material_stmt = select(Material).where(Material.id == item.material_id)
    material = (await db.execute(material_stmt)).scalars().first()
    if not material or not material.is_active:
        raise HTTPException(status_code=400, detail="Material not found or not active")

    unit_price = material.price
    quarry = None
    if item.quarry_id is not None:
        quarry = await db.get(Quarry, item.quarry_id)
        if (
            quarry is None
            or not is_pickup_point_publicly_available(quarry)
        ):
            raise HTTPException(status_code=409, detail="POINT_NOT_AVAILABLE")
        unit_price = await db.scalar(
            select(quarry_materials.c.price).where(
                quarry_materials.c.quarry_id == item.quarry_id,
                quarry_materials.c.material_id == item.material_id,
                quarry_materials.c.is_active.is_(True),
            )
        )
        if unit_price is None:
            raise HTTPException(status_code=409, detail="MATERIAL_NOT_AVAILABLE_AT_POINT")

    # Check min_volume
    if item.volume < material.min_volume:
        raise HTTPException(status_code=400, detail=f"Volume must be at least {material.min_volume}")

    # Check if item already in cart
    cart_item_stmt = select(CartItem).where(
        CartItem.session_key == session_key,
        CartItem.material_id == item.material_id,
        CartItem.quarry_id == item.quarry_id,
    )
    existing_item = (await db.execute(cart_item_stmt)).scalars().first()

    if existing_item:
        existing_item.volume += item.volume
        if unit_price is not None:
            existing_item.unit_price = unit_price
            existing_item.amount = existing_item.volume * float(unit_price)
        cart_item = existing_item
    else:
        amount = item.volume * material.price if material.price is not None else None
        cart_item = CartItem(
            session_key=session_key,
            material_id=item.material_id,
            quarry_id=item.quarry_id,
            volume=item.volume,
            unit_price=unit_price,
            amount=item.volume * float(unit_price) if unit_price is not None else amount,
        )
        db.add(cart_item)

    await db.commit()
    await db.refresh(cart_item, attribute_names=["id", "material", "quarry"])
    return cart_item


@router.patch("/items/{id}", response_model=CartItemOut)
async def update_cart_item(
    id: uuid.UUID,
    item_update: CartItemUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Updates the volume of a cart item."""
    cart_item = await db.get(
        CartItem, id, options=[selectinload(CartItem.material), selectinload(CartItem.quarry)]
    )
    if not cart_item:
        raise HTTPException(status_code=404, detail="Cart item not found")

    if cart_item.quarry_id is not None and (
        cart_item.quarry is None
        or not is_pickup_point_publicly_available(cart_item.quarry)
    ):
        raise HTTPException(status_code=409, detail="POINT_NOT_AVAILABLE")

    material = cart_item.material
    if item_update.volume < material.min_volume:
        raise HTTPException(status_code=400, detail=f"Volume must be at least {material.min_volume}")

    cart_item.volume = item_update.volume
    if cart_item.unit_price is not None:
        cart_item.amount = item_update.volume * float(cart_item.unit_price)

    await db.commit()
    await db.refresh(cart_item)
    return cart_item


@router.delete("/items/{id}", status_code=204)
async def delete_cart_item(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Deletes an item from the cart."""
    cart_item = await db.get(CartItem, id)
    if not cart_item:
        raise HTTPException(status_code=404, detail="Cart item not found")

    await db.delete(cart_item)
    await db.commit()
    return
