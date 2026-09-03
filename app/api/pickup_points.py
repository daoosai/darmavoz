from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import and_, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import (
    CrmStatus,
    Material,
    MediaFile,
    Quarry,
    quarry_materials,
)
from app.schemas.quarry import GlobalPickupPointOut, PickupPointMarkerOut, QuarryOut
from app.services.pickup_points import (
    is_pickup_point_publicly_available,
    pickup_point_payload,
    public_pickup_point_filters,
)

router = APIRouter()


def _disable_map_cache(response: Response) -> None:
    """Map availability must reflect the admin activation toggle immediately."""
    response.headers["Cache-Control"] = "no-store, max-age=0"


def _parse_bbox(value: str | None) -> tuple[float, float, float, float] | None:
    if value is None:
        return None
    try:
        min_lon, min_lat, max_lon, max_lat = [float(part) for part in value.split(",")]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="bbox must be min_lon,min_lat,max_lon,max_lat") from exc
    if min_lon > max_lon or min_lat > max_lat:
        raise HTTPException(status_code=422, detail="bbox bounds are invalid")
    return min_lon, min_lat, max_lon, max_lat


@router.get("/map", response_model=list[PickupPointMarkerOut])
@router.get("", response_model=list[PickupPointMarkerOut])
async def list_pickup_points(
    response: Response,
    material_id: UUID,
    bbox: str | None = None,
    point_type: str | None = None,
    limit: int = Query(default=300, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    _disable_map_cache(response)
    material = await db.get(Material, material_id)
    if material is None or not material.is_active:
        return []
    primary_image = (
        select(MediaFile.public_url)
        .where(MediaFile.entity_type == "quarry", MediaFile.entity_id == Quarry.id)
        .order_by(MediaFile.is_primary.desc(), MediaFile.sort_order.asc(), MediaFile.created_at.asc())
        .limit(1)
        .scalar_subquery()
    )
    stmt = (
        select(
            Quarry.id,
            Quarry.name,
            Quarry.short_name,
            Quarry.point_type,
            Quarry.lat,
            Quarry.lon,
            Quarry.min_delivery_price,
            quarry_materials.c.price,
            literal(material.unit).label("unit"),
            literal(material.is_free).label("is_free"),
            Quarry.crm_status,
            primary_image.label("primary_image_url"),
        )
        .outerjoin(
            quarry_materials,
            and_(
                quarry_materials.c.quarry_id == Quarry.id,
                quarry_materials.c.material_id == material_id,
            ),
        )
        .where(
            Quarry.lat.is_not(None),
            Quarry.lon.is_not(None),
            or_(
                and_(
                    Quarry.crm_status == CrmStatus.activated.value,
                    *public_pickup_point_filters(),
                    quarry_materials.c.is_active.is_(True),
                    or_(
                        quarry_materials.c.price.is_not(None),
                        literal(material.is_free).is_(True),
                    ),
                ),
                Quarry.crm_status == CrmStatus.invite_sent.value,
            ),
        )
        .order_by(Quarry.name.asc())
        .limit(limit)
    )
    if point_type:
        stmt = stmt.where(Quarry.point_type == point_type)
    parsed_bbox = _parse_bbox(bbox)
    if parsed_bbox:
        min_lon, min_lat, max_lon, max_lat = parsed_bbox
        stmt = stmt.where(
            Quarry.lon.between(min_lon, max_lon),
            Quarry.lat.between(min_lat, max_lat),
        )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "short_name": row.short_name or row.name,
            "point_type": row.point_type,
            "lat": row.lat,
            "lon": row.lon,
            "material_id": material_id,
            "price": row.price if row.price is not None else 0,
            "is_free": row.is_free,
            "unit": row.unit,
            "min_delivery_price": row.min_delivery_price or 0,
            "crm_status": row.crm_status,
            "primary_image_url": row.primary_image_url,
        }
        for row in rows
    ]


@router.get("/global", response_model=list[GlobalPickupPointOut])
async def list_global_pickup_points(
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    _disable_map_cache(response)
    result = await db.execute(
        select(Quarry)
        .where(
            Quarry.crm_status.in_(
                [
                    CrmStatus.invite_sent.value,
                    CrmStatus.activated.value,
                ]
            ),
            Quarry.lat.is_not(None),
            Quarry.lon.is_not(None),
        )
        .order_by(
            Quarry.is_vip.desc(),
            Quarry.manual_priority.desc(),
            Quarry.name.asc(),
        )
    )
    items: list[dict] = []
    for point in result.scalars().all():
        payload = await pickup_point_payload(db, point)
        active_offers = [
            {
                "material_id": offer["material_id"],
                "material_name": offer["material_name"],
                "unit": offer["unit"],
                "price": offer["price"],
                "is_free": offer["is_free"],
            }
            for offer in payload["material_offers"]
            if offer["is_active"]
        ]
        items.append(
            {
                "id": payload["id"],
                "name": payload["name"],
                "short_name": payload["short_name"],
                "point_type": payload["point_type"],
                "address": payload["address"],
                "description": payload["description"],
                "contact_phone": payload["contact_phone"],
                "lat": payload["lat"],
                "lon": payload["lon"],
                "primary_image_url": payload["primary_image_url"],
                "material_offers": active_offers,
                "crm_status": payload["crm_status"],
                "is_active": payload["is_active"],
                "is_ready": payload["is_ready"],
                "parsed_data": payload["parsed_data"],
            }
        )
    return items


@router.get("/{point_id}", response_model=QuarryOut)
async def get_pickup_point(
    point_id: UUID,
    material_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    point = await db.get(Quarry, point_id)
    if point is None or (
        point.crm_status == CrmStatus.activated.value
        and not is_pickup_point_publicly_available(point)
    ) or point.crm_status not in {
        CrmStatus.invite_sent.value,
        CrmStatus.activated.value,
    }:
        raise HTTPException(status_code=404, detail="Pickup point not found")
    payload = await pickup_point_payload(db, point)
    active_offers = [offer for offer in payload["material_offers"] if offer["is_active"]]
    if material_id is not None and not any(
        offer["material_id"] == material_id for offer in active_offers
    ):
        raise HTTPException(status_code=404, detail="Material not found at pickup point")
    payload["material_offers"] = active_offers
    return payload
