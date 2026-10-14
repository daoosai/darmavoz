"""Attach public catalog media in one query for catalog and order responses."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import DeliveryOption, Material, MediaFile


async def attach_catalog_media(
    db: AsyncSession,
    materials: list[Material],
    delivery_options: list[DeliveryOption],
) -> None:
    entity_ids = [item.id for item in materials] + [
        item.id for item in delivery_options
    ]
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
        media_map.setdefault((media_file.entity_type, media_file.entity_id), []).append(
            media_file
        )

    for material in materials:
        item_media = sorted(
            media_map.get(("material", material.id), []),
            key=lambda media: (not media.is_primary, media.created_at),
        )
        material.media_files = item_media
        material.primary_image_url = (
            item_media[0].public_url if item_media else material.image_url
        )

    for delivery_option in delivery_options:
        item_media = sorted(
            media_map.get(("delivery_option", delivery_option.id), []),
            key=lambda media: (not media.is_primary, media.created_at),
        )
        delivery_option.media_files = item_media
        delivery_option.primary_image_url = (
            item_media[0].public_url if item_media else delivery_option.image_url
        )
