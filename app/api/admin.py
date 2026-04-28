from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.database import get_db
from app.models.models import User
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
