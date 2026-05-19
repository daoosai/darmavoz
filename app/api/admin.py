from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from sqlalchemy import select
from app.db.database import get_db
from app.models.models import User, Material
from app.schemas.catalog import MaterialOut, MaterialCreate, MaterialUpdate
from app.security.auth import (
    get_current_admin_user,
    get_current_logist_user,
    get_current_manager_user,
)
from app.integrations.avito.client import AvitoAPIClient
from app.integrations.avito.management import AvitoManagementService

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
    current_admin: User = Depends(get_current_admin_user)
):
    try:
        client = AvitoAPIClient()
        service = AvitoManagementService(client, session)
        result = await service.register_webhook(request.webhook_url)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/materials/", response_model=list[MaterialOut])
async def get_all_materials(
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    stmt = select(Material)
    result = await db.execute(stmt)
    return result.scalars().all()

@router.post("/materials/", response_model=MaterialOut)
async def create_material(
    material_in: MaterialCreate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    material = Material(**material_in.model_dump())
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return material

@router.patch("/materials/{id}", response_model=MaterialOut)
async def update_material(
    id: str,
    material_update: MaterialUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    material = await db.get(Material, id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    update_data = material_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(material, key, value)
        
    await db.commit()
    await db.refresh(material)
    return material

@router.delete("/materials/{id}")
async def delete_material(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    material = await db.get(Material, id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    await db.delete(material)
    await db.commit()
    return {"status": "ok", "message": "Material deleted successfully"}
