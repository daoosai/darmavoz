from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.integrations.avito.schemas import AvitoWebhookPayload
from app.integrations.avito.service import AvitoWebhookService
from app.core.config import settings

router = APIRouter(tags=["Webhooks"])

def verify_webhook_secret(x_webhook_secret: str = Header(None)):
    if x_webhook_secret != settings.AVITO_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid secret")
    return x_webhook_secret

@router.post("/avito", dependencies=[Depends(verify_webhook_secret)])
async def avito_webhook(
    payload: AvitoWebhookPayload,
    session: AsyncSession = Depends(get_db)
):
    """
    Эндпоинт для приема вебхуков от Авито.
    Принимает строго типизированный payload и передает в сервис обработки.
    """
    try:
        service = AvitoWebhookService()
        await service.process_inbound_webhook(session, payload)
        return {"ok": True, "status": "processed"}
    except Exception:
        raise HTTPException(status_code=500, detail="Internal processing error")
