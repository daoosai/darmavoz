from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    DeliveryOption,
    Material,
    MediaFile,
    PickupPointType,
    Quarry,
    User,
    quarry_delivery_options,
    quarry_materials,
)
from app.schemas.quarry import QuarryMaterialOfferIn


DEFAULT_MIN_DELIVERY_PRICE = {
    PickupPointType.quarry.value: Decimal("5000.00"),
    PickupPointType.accumulator.value: Decimal("3000.00"),
    PickupPointType.warehouse.value: Decimal("3000.00"),
    PickupPointType.supplier.value: Decimal("3000.00"),
}


def public_pickup_point_filters():
    return (
        Quarry.is_active.is_(True),
        Quarry.moderation_status == ModerationStatus.approved.value,
        or_(
            Quarry.subscription_end_date.is_(None),
            Quarry.subscription_end_date > func.now(),
        ),
    )


def is_pickup_point_publicly_available(
    point: Quarry,
    *,
    now: datetime | None = None,
) -> bool:
    if not point.is_active or point.moderation_status != ModerationStatus.approved.value:
        return False
    if point.subscription_end_date is None:
        return True
    current_time = now or datetime.now(timezone.utc)
    return point.subscription_end_date > current_time


def default_min_delivery_price(point_type: str) -> Decimal | None:
    return DEFAULT_MIN_DELIVERY_PRICE.get(point_type)


async def default_delivery_option_ids(db: AsyncSession, point_type: str) -> list[UUID]:
    stmt = select(DeliveryOption.id).where(DeliveryOption.is_active.is_(True))
    if point_type == PickupPointType.quarry.value:
        stmt = stmt.where(DeliveryOption.capacity_m3 >= 10)
    elif point_type == PickupPointType.accumulator.value:
        stmt = stmt.where(DeliveryOption.capacity_m3 == 5)
    elif point_type not in {
        PickupPointType.warehouse.value,
        PickupPointType.supplier.value,
    }:
        return []
    result = await db.execute(stmt.order_by(DeliveryOption.capacity_m3.asc()))
    return list(result.scalars().all())


async def sync_material_offers(
    db: AsyncSession,
    *,
    quarry_id: UUID,
    offers: list[QuarryMaterialOfferIn] | None = None,
    legacy_material_ids: list[UUID] | None = None,
) -> None:
    if offers is None and legacy_material_ids is None:
        return

    normalized_offers = list(offers or [])
    if not normalized_offers and legacy_material_ids:
        result = await db.execute(
            select(Material).where(Material.id.in_(list(dict.fromkeys(legacy_material_ids))))
        )
        materials = list(result.scalars().all())
        if len(materials) != len(set(legacy_material_ids)):
            raise HTTPException(status_code=404, detail="One or more materials not found")
        normalized_offers = [
            QuarryMaterialOfferIn(
                material_id=material.id,
                price=float(material.price),
                is_active=True,
            )
            for material in materials
            if material.price is not None and float(material.price) > 0
        ]

    material_ids = [offer.material_id for offer in normalized_offers]
    if material_ids:
        count = len(
            list(
                (
                    await db.execute(select(Material.id).where(Material.id.in_(material_ids)))
                ).scalars().all()
            )
        )
        if count != len(set(material_ids)):
            raise HTTPException(status_code=404, detail="One or more materials not found")

    await db.execute(
        update(quarry_materials)
        .where(quarry_materials.c.quarry_id == quarry_id)
        .values(is_active=False)
    )
    for offer in normalized_offers:
        stmt = insert(quarry_materials).values(
            quarry_id=quarry_id,
            material_id=offer.material_id,
            price=offer.price,
            is_active=offer.is_active,
        )
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=[quarry_materials.c.quarry_id, quarry_materials.c.material_id],
                set_={
                    "price": offer.price,
                    "is_active": offer.is_active,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
        )


async def sync_delivery_options(
    db: AsyncSession,
    *,
    quarry_id: UUID,
    delivery_option_ids: Iterable[UUID],
) -> None:
    normalized_ids = list(dict.fromkeys(delivery_option_ids))
    if normalized_ids:
        result = await db.execute(
            select(DeliveryOption.id).where(DeliveryOption.id.in_(normalized_ids))
        )
        if len(list(result.scalars().all())) != len(normalized_ids):
            raise HTTPException(status_code=404, detail="One or more delivery options not found")

    await db.execute(
        update(quarry_delivery_options)
        .where(quarry_delivery_options.c.quarry_id == quarry_id)
        .values(is_active=False)
    )
    for delivery_option_id in normalized_ids:
        stmt = insert(quarry_delivery_options).values(
            quarry_id=quarry_id,
            delivery_option_id=delivery_option_id,
            is_active=True,
        )
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=[
                    quarry_delivery_options.c.quarry_id,
                    quarry_delivery_options.c.delivery_option_id,
                ],
                set_={"is_active": True},
            )
        )


async def pickup_point_payload(
    db: AsyncSession,
    point: Quarry,
    *,
    include_owner_contacts: bool = False,
) -> dict:
    offer_rows = (
        await db.execute(
            select(
                quarry_materials.c.material_id,
                quarry_materials.c.price,
                quarry_materials.c.is_active,
                Material.name,
                Material.unit,
            )
            .join(Material, Material.id == quarry_materials.c.material_id)
            .where(quarry_materials.c.quarry_id == point.id)
            .order_by(Material.name.asc())
        )
    ).all()
    delivery_options = list(
        (
            await db.execute(
                select(DeliveryOption)
                .join(
                    quarry_delivery_options,
                    quarry_delivery_options.c.delivery_option_id == DeliveryOption.id,
                )
                .where(
                    quarry_delivery_options.c.quarry_id == point.id,
                    quarry_delivery_options.c.is_active.is_(True),
                )
                .order_by(DeliveryOption.capacity_m3.asc())
            )
        ).scalars().all()
    )
    delivery_option_ids = [option.id for option in delivery_options]
    delivery_option_media_files = list(
        (
            await db.execute(
                select(MediaFile)
                .where(
                    MediaFile.entity_type == "delivery_option",
                    MediaFile.entity_id.in_(delivery_option_ids),
                )
                .order_by(
                    MediaFile.entity_id.asc(),
                    MediaFile.is_primary.desc(),
                    MediaFile.sort_order.asc(),
                    MediaFile.created_at.asc(),
                )
            )
        ).scalars().all()
    ) if delivery_option_ids else []
    media_files = list(
        (
            await db.execute(
                select(MediaFile)
                .where(MediaFile.entity_type == "quarry", MediaFile.entity_id == point.id)
                .order_by(
                    MediaFile.is_primary.desc(),
                    MediaFile.sort_order.asc(),
                    MediaFile.created_at.asc(),
                )
            )
        ).scalars().all()
    )
    owner = await db.get(User, point.owner_user_id) if point.owner_user_id else None

    active_offers = [row for row in offer_rows if row.is_active]
    material_by_id = {
        row.material_id: Material(id=row.material_id, name=row.name, unit=row.unit, price=row.price)
        for row in active_offers
    }
    media_by_delivery_option: dict = {}
    for media_file in delivery_option_media_files:
        media_by_delivery_option.setdefault(media_file.entity_id, []).append(media_file)
    for option in delivery_options:
        option.media_files = media_by_delivery_option.get(option.id, [])
        option.primary_image_url = (
            option.media_files[0].public_url if option.media_files else option.image_url
        )

    payload = {
        "id": point.id,
        "name": point.name,
        "short_name": point.short_name,
        "point_type": point.point_type,
        "address": point.address,
        "description": point.description,
        "contact_phone": owner.username if owner else point.contact_phone,
        "subscription_end_date": point.subscription_end_date,
        "lat": point.lat,
        "lon": point.lon,
        "min_delivery_price": point.min_delivery_price,
        "rating": point.rating,
        "is_active": point.is_active,
        "moderation_status": point.moderation_status,
        "moderation_comment": point.moderation_comment,
        "owner_user_id": point.owner_user_id,
        "material_ids": list(material_by_id),
        "materials": list(material_by_id.values()),
        "material_offers": [
            {
                "material_id": row.material_id,
                "material_name": row.name,
                "unit": row.unit,
                "price": row.price,
                "is_active": row.is_active,
            }
            for row in offer_rows
        ],
        "delivery_option_ids": [option.id for option in delivery_options],
        "delivery_options": delivery_options,
        "media_files": media_files,
        "primary_image_url": media_files[0].public_url if media_files else None,
        "created_at": point.created_at,
        "updated_at": point.updated_at,
    }
    if include_owner_contacts:
        payload["owner_name"] = owner.display_name if owner else None
        payload["owner_phone"] = owner.username if owner else None
    return payload


async def validate_point_can_be_approved(db: AsyncSession, point: Quarry) -> None:
    payload = await pickup_point_payload(db, point)
    missing: list[str] = []
    if not payload["material_offers"] or not any(
        offer["is_active"] and offer["price"] is not None and float(offer["price"]) > 0
        for offer in payload["material_offers"]
    ):
        missing.append("хотя бы один активный материал с ценой")
    if not payload["delivery_option_ids"]:
        missing.append("хотя бы один вариант доставки")
    if point.min_delivery_price is None:
        missing.append("минимальная стоимость доставки")
    if not payload["media_files"]:
        missing.append("фотография")
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для одобрения заполните: " + ", ".join(missing),
        )
