from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Category, DeliveryOption, Material, MediaFile
from app.schemas.catalog import CategoryOut, DeliveryOptionOut, MaterialOut

router = APIRouter()


async def _get_active_delivery_options(db: AsyncSession) -> list[DeliveryOption]:
    result = await db.execute(
        select(DeliveryOption)
        .where(DeliveryOption.is_active.is_(True))
        .order_by(DeliveryOption.sort_order.asc(), DeliveryOption.capacity_m3.asc())
    )
    return list(result.scalars().all())


def _attach_delivery_options(
    materials: list[Material],
    delivery_options: list[DeliveryOption],
) -> list[Material]:
    for material in materials:
        material.delivery_options = delivery_options
    return materials


async def _attach_media(
    db: AsyncSession,
    materials: list[Material],
    delivery_options: list[DeliveryOption],
) -> None:
    entity_ids = [item.id for item in materials] + [item.id for item in delivery_options]
    if not entity_ids:
        return

    result = await db.execute(
        select(MediaFile).where(
            MediaFile.entity_id.in_(entity_ids),
            MediaFile.entity_type.in_(("material", "delivery_option")),
        )
    )
    media_files = list(result.scalars().all())
    media_map: dict[tuple[str, UUID], list[MediaFile]] = {}
    for media_file in media_files:
        media_map.setdefault((media_file.entity_type, media_file.entity_id), []).append(media_file)

    for material in materials:
        item_media = sorted(
            media_map.get(("material", material.id), []),
            key=lambda media: (not media.is_primary, media.created_at),
        )
        material.media_files = item_media
        material.primary_image_url = item_media[0].public_url if item_media else material.image_url

    for delivery_option in delivery_options:
        item_media = sorted(
            media_map.get(("delivery_option", delivery_option.id), []),
            key=lambda media: (not media.is_primary, media.created_at),
        )
        delivery_option.media_files = item_media
        delivery_option.primary_image_url = item_media[0].public_url if item_media else delivery_option.image_url


@router.get("/categories/", response_model=list[CategoryOut])
async def get_categories(db: AsyncSession = Depends(get_db)) -> list[Category]:
    result = await db.execute(
        select(Category)
        .where(Category.is_active.is_(True))
        .order_by(Category.sort_order.asc(), Category.name.asc())
    )
    return list(result.scalars().all())


@router.get("/materials/", response_model=list[MaterialOut])
async def get_materials(
    category_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[Material]:
    stmt = select(Material).where(Material.is_active.is_(True))
    if category_id is not None:
        stmt = stmt.where(Material.category_id == category_id)

    result = await db.execute(stmt.order_by(Material.sort_order.asc(), Material.name.asc()))
    materials = list(result.scalars().all())
    delivery_options = await _get_active_delivery_options(db)
    await _attach_media(db, materials, delivery_options)
    return _attach_delivery_options(materials, delivery_options)


@router.get("/materials/{material_id}", response_model=MaterialOut)
async def get_material(material_id: UUID, db: AsyncSession = Depends(get_db)) -> Material:
    material = await db.get(Material, material_id)
    if material is None or not material.is_active:
        raise HTTPException(status_code=404, detail="Material not found")
    delivery_options = await _get_active_delivery_options(db)
    await _attach_media(db, [material], delivery_options)
    return _attach_delivery_options([material], delivery_options)[0]


@router.get("/delivery-options/", response_model=list[DeliveryOptionOut])
async def get_delivery_options(db: AsyncSession = Depends(get_db)) -> list[DeliveryOption]:
    result = await db.execute(
        select(DeliveryOption)
        .where(DeliveryOption.is_active.is_(True))
        .order_by(DeliveryOption.sort_order.asc(), DeliveryOption.capacity_m3.asc())
    )
    delivery_options = list(result.scalars().all())
    await _attach_media(db, [], delivery_options)
    return delivery_options
