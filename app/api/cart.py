import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import CartItem, Material
from app.schemas.catalog import CartItemCreate, CartItemOut

router = APIRouter()


@router.get("/", response_model=List[CartItemOut])
async def get_cart_items(
    session_key: str = Header(...),
    db: AsyncSession = Depends(get_db)
):
    """Returns a list of cart items for a given session_key."""
    stmt = (
        select(CartItem)
        .where(CartItem.session_key == session_key)
        .options(selectinload(CartItem.material))
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/items", response_model=CartItemOut)
async def add_cart_item(
    item: CartItemCreate,
    session_key: str = Header(...),
    db: AsyncSession = Depends(get_db)
):
    """Adds a material to the cart or updates its volume if it already exists."""
    # Check if material exists and is active
    material_stmt = select(Material).where(Material.id == item.material_id)
    material = (await db.execute(material_stmt)).scalars().first()
    if not material or not material.is_active:
        raise HTTPException(status_code=400, detail="Material not found or not active")

    # Check min_volume
    if item.volume < material.min_volume:
        raise HTTPException(status_code=400, detail=f"Volume must be at least {material.min_volume}")

    # Check if item already in cart
    cart_item_stmt = select(CartItem).where(
        CartItem.session_key == session_key,
        CartItem.material_id == item.material_id
    )
    existing_item = (await db.execute(cart_item_stmt)).scalars().first()

    if existing_item:
        existing_item.volume += item.volume
        if material.price:
            existing_item.amount = existing_item.volume * material.price
        cart_item = existing_item
    else:
        amount = item.volume * material.price if material.price else None
        cart_item = CartItem(
            session_key=session_key,
            material_id=item.material_id,
            volume=item.volume,
            unit_price=material.price,
            amount=amount
        )
        db.add(cart_item)

    await db.commit()
    await db.refresh(cart_item, attribute_names=["id", "material"])
    return cart_item


@router.patch("/items/{id}", response_model=CartItemOut)
async def update_cart_item(
    id: uuid.UUID,
    volume: float,
    db: AsyncSession = Depends(get_db)
):
    """Updates the volume of a cart item."""
    cart_item = await db.get(CartItem, id, options=[selectinload(CartItem.material)])
    if not cart_item:
        raise HTTPException(status_code=404, detail="Cart item not found")

    material = cart_item.material
    if volume < material.min_volume:
        raise HTTPException(status_code=400, detail=f"Volume must be at least {material.min_volume}")

    cart_item.volume = volume
    if material.price:
        cart_item.amount = volume * material.price

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
