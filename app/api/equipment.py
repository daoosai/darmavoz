import re
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.database import get_db
from app.models.models import (
    Client,
    MediaFile,
    SpecialEquipmentApplication,
    SpecialEquipmentListing,
    SpecialEquipmentType,
    User,
)
from app.schemas.equipment import (
    EquipmentApplicationCancel,
    EquipmentApplicationCreate,
    EquipmentApplicationOut,
    EquipmentApplicationReject,
    EquipmentApplicationStatusUpdate,
    EquipmentListingCreate,
    EquipmentListingOut,
    EquipmentListingUpdate,
    EquipmentTypeCreate,
    EquipmentTypeOut,
    EquipmentTypeUpdate,
)
from app.security.auth import get_current_admin_user, get_current_client, get_current_logist_user
from app.services.notifications import (
    schedule_equipment_application_cancelled_notification,
    schedule_equipment_application_notification,
    schedule_equipment_application_rejected_notification,
)
from app.services.email_service import send_email
from app.utils.phones import normalize_phone

router = APIRouter()


def _format_duration_value(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value}".rstrip("0").rstrip(".")


def _duration_unit_label(value: str) -> str:
    return "часов" if value == "hours" else "смен"


def _coerce_tariff_number(value: object, *, max_value: float | None = None) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    if max_value is not None and number > max_value:
        return None
    return number


def _normalize_listing_tariffs(raw_tariffs: object) -> list[dict]:
    if not isinstance(raw_tariffs, list):
        return []

    normalized: list[dict] = []
    for item in raw_tariffs:
        if not isinstance(item, dict):
            continue

        tariff_type = item.get("type")
        if tariff_type not in ("hour", "shift"):
            continue

        price = _coerce_tariff_number(item.get("price"))
        if tariff_type == "hour":
            normalized.append({"type": "hour", "price": price, "hours": None})
            continue

        hours = _coerce_tariff_number(item.get("hours"), max_value=24)
        if hours is None:
            continue
        normalized.append({"type": "shift", "price": price, "hours": hours})

    return normalized


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9а-яё]+", "-", value.strip().lower(), flags=re.IGNORECASE)
    return slug.strip("-") or "equipment"


async def _unique_type_slug(
    db: AsyncSession, name: str, *, exclude_id: UUID | None = None
) -> str:
    base = _slugify(name)
    candidate = base
    suffix = 2
    while True:
        stmt = select(SpecialEquipmentType.id).where(SpecialEquipmentType.slug == candidate)
        if exclude_id is not None:
            stmt = stmt.where(SpecialEquipmentType.id != exclude_id)
        if await db.scalar(stmt) is None:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


async def _listing_media(db: AsyncSession, listing_id: UUID) -> list[MediaFile]:
    result = await db.execute(
        select(MediaFile)
        .where(
            MediaFile.entity_type == "equipment_listing",
            MediaFile.entity_id == listing_id,
        )
        .order_by(
            MediaFile.is_primary.desc(),
            MediaFile.sort_order.asc(),
            MediaFile.created_at.asc(),
        )
    )
    return list(result.scalars().all())


async def _listing_payload(db: AsyncSession, listing: SpecialEquipmentListing) -> dict:
    media = await _listing_media(db, listing.id)
    return {
        "id": listing.id,
        "equipment_type_id": listing.equipment_type_id,
        "equipment_type_name": listing.equipment_type.name,
        "title": listing.title,
        "description": listing.description,
        "tariffs": _normalize_listing_tariffs(listing.tariffs),
        "city": listing.city,
        "district": listing.district,
        "is_active": listing.is_active,
        "sort_order": listing.sort_order,
        "media_files": media,
        "primary_image_url": media[0].public_url if media else None,
        "created_at": listing.created_at,
        "updated_at": listing.updated_at,
    }


async def _application_payload(
    db: AsyncSession, application: SpecialEquipmentApplication
) -> dict:
    media = await _listing_media(db, application.listing_id)
    return {
        "id": application.id,
        "listing_id": application.listing_id,
        "client_id": application.client_id,
        "listing_title_snapshot": application.listing_title_snapshot,
        "contact_phone": application.contact_phone,
        "client_name": application.client.name if application.client else None,
        "object_address": application.object_address,
        "requested_date": application.requested_date,
        "requested_time": application.requested_time,
        "duration_value": application.duration_value,
        "duration_unit": application.duration_unit,
        "total_price": float(application.total_price) if application.total_price is not None else None,
        "comment": application.comment,
        "reject_reason": application.reject_reason,
        "cancel_reason": application.cancel_reason,
        "status": application.status,
        "processed_by_user_id": application.processed_by_user_id,
        "primary_image_url": media[0].public_url if media else None,
        "created_at": application.created_at,
        "updated_at": application.updated_at,
        "closed_at": application.closed_at,
    }


async def _get_listing(
    db: AsyncSession,
    listing_id: UUID,
    *,
    include_deleted: bool = False,
) -> SpecialEquipmentListing:
    stmt = (
        select(SpecialEquipmentListing)
        .options(selectinload(SpecialEquipmentListing.equipment_type))
        .where(SpecialEquipmentListing.id == listing_id)
    )
    if not include_deleted:
        stmt = stmt.where(SpecialEquipmentListing.is_deleted.is_(False))
    result = await db.execute(stmt)
    listing = result.scalar_one_or_none()
    if listing is None:
        raise HTTPException(status_code=404, detail="Объявление спецтехники не найдено")
    return listing


def _calculate_application_total(
    listing: SpecialEquipmentListing,
    duration_unit: str,
    duration_value: float,
) -> float | None:
    tariff_type = "hour" if duration_unit == "hours" else "shift"
    tariff = next(
        (item for item in _normalize_listing_tariffs(listing.tariffs) if item.get("type") == tariff_type),
        None,
    )
    if tariff is None:
        label = "Часы" if tariff_type == "hour" else "Смены"
        raise HTTPException(status_code=400, detail=f"Тариф «{label}» недоступен")
    price = tariff.get("price")
    if price is None:
        return None
    total = Decimal(str(price)) * Decimal(str(duration_value))
    return float(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


@router.get("/equipment/types", response_model=list[EquipmentTypeOut])
@router.get(
    "/catalog/equipment-types",
    response_model=list[EquipmentTypeOut],
    include_in_schema=False,
)
async def list_public_equipment_types(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SpecialEquipmentType)
        .where(SpecialEquipmentType.is_active.is_(True))
        .order_by(SpecialEquipmentType.sort_order.asc(), SpecialEquipmentType.name.asc())
    )
    return list(result.scalars().all())


@router.get("/equipment", response_model=list[EquipmentListingOut])
@router.get(
    "/catalog/equipment",
    response_model=list[EquipmentListingOut],
    include_in_schema=False,
)
async def list_public_equipment(
    equipment_type_id: UUID | None = None,
    city: str | None = Query(default=None, max_length=255),
    district: str | None = Query(default=None, max_length=255),
    search: str | None = Query(default=None, max_length=255),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(SpecialEquipmentListing)
        .join(SpecialEquipmentListing.equipment_type)
        .options(selectinload(SpecialEquipmentListing.equipment_type))
        .where(
            SpecialEquipmentListing.is_active.is_(True),
            SpecialEquipmentListing.is_deleted.is_(False),
            SpecialEquipmentType.is_active.is_(True),
        )
    )
    if equipment_type_id:
        stmt = stmt.where(SpecialEquipmentListing.equipment_type_id == equipment_type_id)
    if city:
        stmt = stmt.where(func.lower(SpecialEquipmentListing.city) == city.strip().lower())
    if district:
        stmt = stmt.where(func.lower(SpecialEquipmentListing.district) == district.strip().lower())
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            SpecialEquipmentListing.title.ilike(pattern)
            | SpecialEquipmentListing.description.ilike(pattern)
        )
    result = await db.execute(
        stmt.order_by(
            SpecialEquipmentListing.sort_order.asc(),
            SpecialEquipmentListing.created_at.desc(),
        )
    )
    return [await _listing_payload(db, item) for item in result.scalars().unique().all()]


@router.get("/equipment/{listing_id}", response_model=EquipmentListingOut)
@router.get(
    "/catalog/equipment/{listing_id}",
    response_model=EquipmentListingOut,
    include_in_schema=False,
)
async def get_public_equipment(listing_id: UUID, db: AsyncSession = Depends(get_db)):
    listing = await _get_listing(db, listing_id)
    if not listing.is_active or not listing.equipment_type.is_active:
        raise HTTPException(status_code=404, detail="Объявление спецтехники не найдено")
    return await _listing_payload(db, listing)


@router.get("/admin/equipment-types", response_model=list[EquipmentTypeOut])
async def list_admin_equipment_types(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    result = await db.execute(
        select(SpecialEquipmentType).order_by(
            SpecialEquipmentType.sort_order.asc(), SpecialEquipmentType.name.asc()
        )
    )
    return list(result.scalars().all())


@router.post(
    "/admin/equipment-types",
    response_model=EquipmentTypeOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_equipment_type(
    payload: EquipmentTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    item = SpecialEquipmentType(
        name=payload.name,
        slug=await _unique_type_slug(db, payload.name),
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/admin/equipment-types/{type_id}", response_model=EquipmentTypeOut)
async def update_equipment_type(
    type_id: UUID,
    payload: EquipmentTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    item = await db.get(SpecialEquipmentType, type_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Тип спецтехники не найден")
    changed = payload.model_fields_set
    if "name" in changed and payload.name is not None:
        item.name = payload.name
        item.slug = await _unique_type_slug(db, payload.name, exclude_id=item.id)
    if "is_active" in changed:
        item.is_active = bool(payload.is_active)
    if "sort_order" in changed and payload.sort_order is not None:
        item.sort_order = payload.sort_order
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/admin/equipment-types/{type_id}")
async def delete_equipment_type(
    type_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    item = await db.get(SpecialEquipmentType, type_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Тип спецтехники не найден")
    listing_count = await db.scalar(
        select(func.count()).select_from(SpecialEquipmentListing).where(
            SpecialEquipmentListing.equipment_type_id == type_id
        )
    )
    if listing_count:
        item.is_active = False
        result = "hidden"
    else:
        await db.delete(item)
        result = "deleted"
    await db.commit()
    return {"ok": True, "result": result}


@router.get("/admin/equipment", response_model=list[EquipmentListingOut])
async def list_admin_equipment(
    equipment_type_id: UUID | None = None,
    is_active: bool | None = None,
    search: str | None = Query(default=None, max_length=255),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    stmt = select(SpecialEquipmentListing).options(
        selectinload(SpecialEquipmentListing.equipment_type)
    ).where(SpecialEquipmentListing.is_deleted.is_(False))
    if equipment_type_id:
        stmt = stmt.where(SpecialEquipmentListing.equipment_type_id == equipment_type_id)
    if is_active is not None:
        stmt = stmt.where(SpecialEquipmentListing.is_active.is_(is_active))
    if search:
        stmt = stmt.where(SpecialEquipmentListing.title.ilike(f"%{search.strip()}%"))
    result = await db.execute(
        stmt.order_by(SpecialEquipmentListing.sort_order.asc(), SpecialEquipmentListing.created_at.desc())
    )
    return [await _listing_payload(db, item) for item in result.scalars().all()]


@router.post(
    "/admin/equipment",
    response_model=EquipmentListingOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_equipment_listing(
    payload: EquipmentListingCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    equipment_type = await db.get(SpecialEquipmentType, payload.equipment_type_id)
    if equipment_type is None:
        raise HTTPException(status_code=400, detail="Тип спецтехники не найден")
    listing = SpecialEquipmentListing(
        **payload.model_dump(),
        created_by_user_id=current_admin.id,
        is_deleted=False,
    )
    db.add(listing)
    await db.commit()
    return await _listing_payload(db, await _get_listing(db, listing.id))


@router.get("/admin/equipment/{listing_id}", response_model=EquipmentListingOut)
async def get_admin_equipment(
    listing_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    return await _listing_payload(db, await _get_listing(db, listing_id))


@router.patch("/admin/equipment/{listing_id}", response_model=EquipmentListingOut)
async def update_equipment_listing(
    listing_id: UUID,
    payload: EquipmentListingUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    listing = await _get_listing(db, listing_id)
    changed = payload.model_fields_set
    if "equipment_type_id" in changed and payload.equipment_type_id is not None:
        if await db.get(SpecialEquipmentType, payload.equipment_type_id) is None:
            raise HTTPException(status_code=400, detail="Тип спецтехники не найден")
    for field in (
        "equipment_type_id",
        "title",
        "description",
        "tariffs",
        "city",
        "district",
        "is_active",
        "sort_order",
    ):
        if field in changed:
            value = getattr(payload, field)
            if field == "tariffs" and value is not None:
                value = [tariff.model_dump() for tariff in value]
            setattr(listing, field, value)
    await db.commit()
    return await _listing_payload(db, await _get_listing(db, listing.id))


@router.delete("/admin/equipment/{listing_id}")
async def delete_equipment_listing(
    listing_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    listing = await _get_listing(db, listing_id)
    listing.is_active = False
    listing.is_deleted = True
    try:
        await db.commit()
    except SQLAlchemyError as error:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Не удалось удалить объявление спецтехники",
        ) from error
    return {"ok": True, "result": "hidden"}


@router.post(
    "/client/equipment-applications",
    response_model=EquipmentApplicationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_equipment_application(
    payload: EquipmentApplicationCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_client: Client = Depends(get_current_client),
):
    listing = await _get_listing(db, payload.listing_id)
    if not listing.is_active or not listing.equipment_type.is_active:
        raise HTTPException(status_code=400, detail="Объявление больше не активно")
    if payload.requested_date < date.today():
        raise HTTPException(status_code=400, detail="Дата работ не может быть в прошлом")
    active_application_id = await db.scalar(
        select(SpecialEquipmentApplication.id).where(
            SpecialEquipmentApplication.listing_id == listing.id,
            SpecialEquipmentApplication.client_id == current_client.id,
            SpecialEquipmentApplication.status.in_(("new", "in_progress")),
        )
    )
    if active_application_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Активная заявка на эту технику уже отправлена",
        )
    application = SpecialEquipmentApplication(
        listing_id=listing.id,
        client_id=current_client.id,
        listing_title_snapshot=listing.title,
        contact_phone=normalize_phone(payload.contact_phone),
        object_address=payload.object_address,
        requested_date=payload.requested_date,
        requested_time=payload.requested_time,
        duration_value=payload.duration_value,
        duration_unit=payload.duration_unit,
        total_price=_calculate_application_total(
            listing,
            payload.duration_unit,
            payload.duration_value,
        ),
        comment=payload.comment,
        status="new",
    )
    db.add(application)
    await db.commit()
    result = await db.execute(
        select(SpecialEquipmentApplication)
        .options(selectinload(SpecialEquipmentApplication.client))
        .where(SpecialEquipmentApplication.id == application.id)
    )
    application = result.scalar_one()
    schedule_equipment_application_notification(application)

    if settings.ADMIN_EMAIL:
        comment = payload.comment.strip() if payload.comment else "Не указан"
        background_tasks.add_task(
            send_email,
            to_email=settings.ADMIN_EMAIL,
            subject="Новая заявка на спецтехнику!",
            body=(
                "НОВАЯ ЗАЯВКА\n"
                f"{listing.title}\n"
                f"{(current_client.name or 'Клиент').strip()} · {application.contact_phone}\n"
                f"{payload.object_address}\n"
                f"{payload.requested_date.strftime('%d.%m.%Y')} в {payload.requested_time.strftime('%H:%M')} · "
                f"{_format_duration_value(payload.duration_value)} {_duration_unit_label(payload.duration_unit)}\n"
                f"Комментарий: {comment}"
            ),
        )

    return await _application_payload(db, application)


@router.get("/client/equipment-applications", response_model=list[EquipmentApplicationOut])
async def list_client_equipment_applications(
    db: AsyncSession = Depends(get_db),
    current_client: Client = Depends(get_current_client),
):
    result = await db.execute(
        select(SpecialEquipmentApplication)
        .options(selectinload(SpecialEquipmentApplication.client))
        .where(SpecialEquipmentApplication.client_id == current_client.id)
        .order_by(SpecialEquipmentApplication.created_at.desc())
    )
    return [await _application_payload(db, item) for item in result.scalars().all()]


@router.get(
    "/client/equipment-applications/{application_id}",
    response_model=EquipmentApplicationOut,
)
async def get_client_equipment_application(
    application_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_client: Client = Depends(get_current_client),
):
    result = await db.execute(
        select(SpecialEquipmentApplication)
        .options(selectinload(SpecialEquipmentApplication.client))
        .where(
            SpecialEquipmentApplication.id == application_id,
            SpecialEquipmentApplication.client_id == current_client.id,
        )
    )
    application = result.scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return await _application_payload(db, application)


@router.patch(
    "/client/equipment-applications/{application_id}/cancel",
    response_model=EquipmentApplicationOut,
)
async def cancel_client_equipment_application(
    application_id: UUID,
    payload: EquipmentApplicationCancel,
    db: AsyncSession = Depends(get_db),
    current_client: Client = Depends(get_current_client),
):
    result = await db.execute(
        select(SpecialEquipmentApplication)
        .options(selectinload(SpecialEquipmentApplication.client))
        .where(
            SpecialEquipmentApplication.id == application_id,
            SpecialEquipmentApplication.client_id == current_client.id,
        )
    )
    application = result.scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if application.status not in {"new", "in_progress"}:
        raise HTTPException(status_code=409, detail="Эту заявку уже нельзя отменить")
    application.status = "cancelled"
    application.cancel_reason = payload.cancel_reason
    application.reject_reason = None
    application.closed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(application)
    schedule_equipment_application_cancelled_notification(application)
    return await _application_payload(db, application)


@router.get("/admin/equipment-applications", response_model=list[EquipmentApplicationOut])
async def list_operator_equipment_applications(
    application_status: str | None = Query(default=None, alias="status"),
    equipment_type_id: UUID | None = None,
    requested_from: date | None = None,
    requested_to: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    stmt = (
        select(SpecialEquipmentApplication)
        .join(SpecialEquipmentApplication.listing)
        .options(selectinload(SpecialEquipmentApplication.client))
    )
    if application_status:
        stmt = stmt.where(SpecialEquipmentApplication.status == application_status)
    if equipment_type_id:
        stmt = stmt.where(SpecialEquipmentListing.equipment_type_id == equipment_type_id)
    if requested_from:
        stmt = stmt.where(SpecialEquipmentApplication.requested_date >= requested_from)
    if requested_to:
        stmt = stmt.where(SpecialEquipmentApplication.requested_date <= requested_to)
    result = await db.execute(stmt.order_by(SpecialEquipmentApplication.created_at.desc()))
    return [await _application_payload(db, item) for item in result.scalars().all()]


@router.get(
    "/admin/equipment-applications/{application_id}",
    response_model=EquipmentApplicationOut,
)
async def get_operator_equipment_application(
    application_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    del current_user
    result = await db.execute(
        select(SpecialEquipmentApplication)
        .options(selectinload(SpecialEquipmentApplication.client))
        .where(SpecialEquipmentApplication.id == application_id)
    )
    application = result.scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return await _application_payload(db, application)


@router.patch(
    "/admin/equipment-applications/{application_id}/status",
    response_model=EquipmentApplicationOut,
)
async def update_equipment_application_status(
    application_id: UUID,
    payload: EquipmentApplicationStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    result = await db.execute(
        select(SpecialEquipmentApplication)
        .options(selectinload(SpecialEquipmentApplication.client))
        .where(SpecialEquipmentApplication.id == application_id)
    )
    application = result.scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    allowed = {
        "new": {"in_progress", "rejected"},
        "in_progress": {"completed", "rejected"},
    }
    if payload.status == "rejected" and application.status not in {"new", "in_progress"}:
        raise HTTPException(status_code=400, detail="Заявка уже обработана")
    if payload.status not in allowed.get(application.status, set()):
        raise HTTPException(status_code=409, detail="Недопустимый переход статуса заявки")
    application.status = payload.status
    application.reject_reason = payload.reject_reason if payload.status == "rejected" else None
    application.processed_by_user_id = current_user.id
    application.closed_at = (
        datetime.now(timezone.utc) if payload.status in {"completed", "rejected"} else None
    )
    await db.commit()
    await db.refresh(application)
    if application.status == "rejected":
        schedule_equipment_application_rejected_notification(application)
    return await _application_payload(db, application)


@router.patch(
    "/admin/equipment-applications/{application_id}/reject",
    response_model=EquipmentApplicationOut,
)
async def reject_equipment_application(
    application_id: UUID,
    payload: EquipmentApplicationReject,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
):
    return await update_equipment_application_status(
        application_id=application_id,
        payload=EquipmentApplicationStatusUpdate(
            status="rejected",
            reject_reason=payload.reject_reason,
        ),
        db=db,
        current_user=current_user,
    )
