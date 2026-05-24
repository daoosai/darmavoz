from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.integrations.avito.client import AvitoAPIClient
from app.integrations.avito.management import AvitoManagementService
from app.models.models import DeliveryOption, Material, Order, User
from app.schemas.catalog import (
    DeliveryOptionCreate,
    DeliveryOptionOut,
    DeliveryOptionUpdate,
    MaterialCreate,
    MaterialOut,
    MaterialUpdate,
)
from app.security.auth import (
    get_current_admin_user,
    get_current_logist_user,
    get_current_manager_user,
)

router = APIRouter()


@router.get("/stats")
async def get_admin_stats(current_admin: User = Depends(get_current_admin_user)):
    return {"status": "ok", "message": "Admin area", "role": current_admin.role.name}


@router.get("/logist-area")
async def get_logist_area(current_user: User = Depends(get_current_logist_user)):
    return {"status": "ok", "message": "Logist area", "role": current_user.role.name}


@router.get("/manager-area")
async def get_manager_area(current_user: User = Depends(get_current_manager_user)):
    return {"status": "ok", "message": "Manager area", "role": current_user.role.name}


class WebhookRegistrationRequest(BaseModel):
    webhook_url: str


@router.post("/avito/webhook/register")
async def register_avito_webhook(
    request: WebhookRegistrationRequest,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    try:
        client = AvitoAPIClient()
        service = AvitoManagementService(client, session)
        return await service.register_webhook(request.webhook_url)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/materials/", response_model=list[MaterialOut])
async def get_all_materials(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    result = await db.execute(select(Material).order_by(Material.sort_order.asc(), Material.name.asc()))
    return list(result.scalars().all())


@router.post("/materials/", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
async def create_material(
    material_in: MaterialCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    material = Material(**material_in.model_dump())
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return material


@router.patch("/materials/{material_id}", response_model=MaterialOut)
async def update_material(
    material_id: UUID,
    material_update: MaterialUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")

    for key, value in material_update.model_dump(exclude_unset=True).items():
        setattr(material, key, value)

    await db.commit()
    await db.refresh(material)
    return material


@router.get("/delivery-options", response_model=list[DeliveryOptionOut])
async def list_delivery_options(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    result = await db.execute(
        select(DeliveryOption).order_by(DeliveryOption.sort_order.asc(), DeliveryOption.capacity_m3.asc())
    )
    return list(result.scalars().all())


@router.get("/delivery-options/{delivery_option_id}", response_model=DeliveryOptionOut)
async def get_delivery_option(
    delivery_option_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    delivery_option = await db.get(DeliveryOption, delivery_option_id)
    if delivery_option is None:
        raise HTTPException(status_code=404, detail="Delivery option not found")
    return delivery_option


@router.post("/delivery-options", response_model=DeliveryOptionOut, status_code=status.HTTP_201_CREATED)
async def create_delivery_option(
    payload: DeliveryOptionCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    delivery_option = DeliveryOption(**payload.model_dump())
    db.add(delivery_option)
    await db.commit()
    await db.refresh(delivery_option)
    return delivery_option


@router.patch("/delivery-options/{delivery_option_id}", response_model=DeliveryOptionOut)
async def update_delivery_option(
    delivery_option_id: UUID,
    payload: DeliveryOptionUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    delivery_option = await db.get(DeliveryOption, delivery_option_id)
    if delivery_option is None:
        raise HTTPException(status_code=404, detail="Delivery option not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(delivery_option, field, value)

    await db.commit()
    await db.refresh(delivery_option)
    return delivery_option


@router.delete("/delivery-options/{delivery_option_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_delivery_option(
    delivery_option_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    del current_admin
    delivery_option = await db.get(DeliveryOption, delivery_option_id)
    if delivery_option is None:
        raise HTTPException(status_code=404, detail="Delivery option not found")

    linked_orders_count = await db.scalar(
        select(func.count(Order.id)).where(Order.delivery_option_id == delivery_option_id)
    )
    if linked_orders_count:
        raise HTTPException(
            status_code=409,
            detail="Delivery option is used in orders and cannot be deleted",
        )

    await db.delete(delivery_option)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
