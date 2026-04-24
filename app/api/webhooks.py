from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.integrations.avito.schemas import AvitoWebhookPayload
from app.integrations.avito.service import AvitoWebhookService

router = APIRouter(tags=["Webhooks"])

@router.post("/avito")
async def avito_webhook(
    payload: AvitoWebhookPayload,
    session: AsyncSession = Depends(get_db)
):
    """
    Эндпоинт для приема вебхуков от Авито.
    Принимает строго типизированный payload и передает в сервис обработки.
    """
    service = AvitoWebhookService()
    await service.process_inbound_webhook(session, payload)
    
    return {"ok": True, "status": "processed"}
