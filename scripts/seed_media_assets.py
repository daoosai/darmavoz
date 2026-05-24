import asyncio
import mimetypes
import urllib.request
import uuid
from pathlib import Path

from sqlalchemy import and_, select, update

from app.db.database import AsyncSessionLocal
from app.models.models import DeliveryOption, Material, MediaFile
from app.services.storage import get_storage_service

BASE_DIR = Path(__file__).resolve().parents[1]
STATIC_MATERIALS_DIR = BASE_DIR / "static" / "materials"
TMP_DELIVERY_DIR = BASE_DIR / "static" / "delivery-options"

MATERIAL_FILE_MAP = {
    "Песок строительный": "pesok-stroitelnyy.jpg",
    "Песок речной": "pesok-rechnoy.jpg",
    "Щебень гранитный 5-20 мм": "shcheben-granitnyy-5-20.jpg",
    "Плодородный грунт": "plodorodnyy-grunt.jpg",
}

MATERIAL_REMOTE_URL_MAP = {
    "Песок строительный": "https://upload.wikimedia.org/wikipedia/commons/0/0a/Pile_of_fine_sand_at_Brastad_Arena_1.jpg",
    "Песок речной": "https://upload.wikimedia.org/wikipedia/commons/b/be/Sand_extracted_from_the_river.jpg",
    "Щебень гранитный 5-20 мм": "https://upload.wikimedia.org/wikipedia/commons/5/56/Gravel_pile_at_the_Old_Stone_Quarry%2C_Sevastopol%2C_Door_County%2C_Wisconsin.jpg",
    "Плодородный грунт": "https://upload.wikimedia.org/wikipedia/commons/2/21/628_REG_TOPSOIL_%287%29.JPG",
}

DELIVERY_IMAGE_SOURCES = {
    5.0: "https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1200&q=80",
    10.0: "https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1200&q=80",
    17.0: "https://images.unsplash.com/photo-1504215680853-026ed2a45def?auto=format&fit=crop&w=1200&q=80",
    20.0: "https://images.unsplash.com/photo-1504215680853-026ed2a45def?auto=format&fit=crop&w=1200&q=80",
    25.0: "https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1200&q=80",
    30.0: "https://images.unsplash.com/photo-1504215680853-026ed2a45def?auto=format&fit=crop&w=1200&q=80",
}

REQUEST_HEADERS = {
    "User-Agent": "DarmavozMediaSeeder/1.0 (+https://darmavoz.ru)",
}


def download_file(source_url: str, file_path: Path) -> None:
    request = urllib.request.Request(source_url, headers=REQUEST_HEADERS)
    with urllib.request.urlopen(request) as response, file_path.open("wb") as target:
        target.write(response.read())


def ensure_delivery_images() -> dict[float, Path]:
    TMP_DELIVERY_DIR.mkdir(parents=True, exist_ok=True)
    result: dict[float, Path] = {}
    for capacity_m3, source_url in DELIVERY_IMAGE_SOURCES.items():
        file_path = TMP_DELIVERY_DIR / f"truck-{int(capacity_m3)}m3.jpg"
        if not file_path.exists():
            download_file(source_url, file_path)
        result[capacity_m3] = file_path
    return result


def ensure_material_images() -> dict[str, Path]:
    STATIC_MATERIALS_DIR.mkdir(parents=True, exist_ok=True)
    result: dict[str, Path] = {}
    for material_name, file_name in MATERIAL_FILE_MAP.items():
        file_path = STATIC_MATERIALS_DIR / file_name
        if not file_path.exists() or file_path.stat().st_size < 10_000:
            source_url = MATERIAL_REMOTE_URL_MAP.get(material_name)
            if not source_url:
                continue
            download_file(source_url, file_path)
        result[material_name] = file_path
    return result


async def upsert_media_record(
    session,
    *,
    bucket: str,
    entity_type: str,
    entity_id,
    object_key: str,
    file_path: Path,
    public_url: str,
    is_primary: bool = True,
) -> None:
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    file_size = file_path.stat().st_size

    if is_primary:
        await session.execute(
            update(MediaFile)
            .where(
                and_(
                    MediaFile.entity_type == entity_type,
                    MediaFile.entity_id == entity_id,
                    MediaFile.is_primary.is_(True),
                )
            )
            .values(is_primary=False)
        )

    result = await session.execute(select(MediaFile).where(MediaFile.object_key == object_key))
    media = result.scalar_one_or_none()
    if media is None:
        media = MediaFile(
            entity_type=entity_type,
            entity_id=entity_id,
            bucket=bucket,
            object_key=object_key,
            public_url=public_url,
            content_type=content_type,
            file_name=file_path.name,
            file_size=file_size,
            is_primary=is_primary,
        )
        session.add(media)
    else:
        media.entity_type = entity_type
        media.entity_id = entity_id
        media.public_url = public_url
        media.content_type = content_type
        media.file_name = file_path.name
        media.file_size = file_size
        media.is_primary = is_primary


async def seed_material_media() -> None:
    storage = get_storage_service()
    material_images = ensure_material_images()
    delivery_images = ensure_delivery_images()

    async with AsyncSessionLocal() as session:
        material_result = await session.execute(select(Material))
        materials = list(material_result.scalars().all())
        for material in materials:
            file_path = material_images.get(material.name)
            if file_path is None:
                continue
            if not file_path.exists():
                continue
            suffix = file_path.suffix.lower()
            object_key = f"{storage.prefix}/materials/{material.id}{suffix}" if storage.prefix else f"materials/{material.id}{suffix}"
            public_url = storage.upload_file(str(file_path), object_key, "image/jpeg")
            await upsert_media_record(
                session,
                bucket=storage.bucket,
                entity_type="material",
                entity_id=material.id,
                object_key=object_key,
                file_path=file_path,
                public_url=public_url,
                is_primary=True,
            )
            material.image_url = public_url

        option_result = await session.execute(select(DeliveryOption))
        options = list(option_result.scalars().all())
        for option in options:
            file_path = delivery_images.get(option.capacity_m3)
            if not file_path:
                continue
            suffix = file_path.suffix.lower()
            object_key = (
                f"{storage.prefix}/delivery-options/{option.id}{suffix}"
                if storage.prefix
                else f"delivery-options/{option.id}{suffix}"
            )
            public_url = storage.upload_file(str(file_path), object_key, "image/jpeg")
            await upsert_media_record(
                session,
                bucket=storage.bucket,
                entity_type="delivery_option",
                entity_id=option.id,
                object_key=object_key,
                file_path=file_path,
                public_url=public_url,
                is_primary=True,
            )
            option.image_url = public_url

        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed_material_media())
