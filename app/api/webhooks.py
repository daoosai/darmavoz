from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.integrations.avito.service import AvitoWebhookService

router = APIRouter(tags=["Webhooks"])

@router.post("/avito")
async def avito_webhook(
    request: Request,
    session: AsyncSession = Depends(get_db)
):
    """
    Эндпоинт для приема вебхуков от Авито.
    Принимает сырой JSON-payload и передает в сервис обработки.
    """
    # Используем request.json() для надежного извлечения сырого payload
    payload = await request.json()
    
    # Инстанцируем сервис и обрабатываем вебхук
    service = AvitoWebhookService()
    await service.process_inbound_webhook(session, payload)
    
    # Всегда возвращаем 200 OK, даже если внутри была ошибка,
    # чтобы Авито не повторял отправку сбойных вебхуков
    return {"ok": True, "status": "processed"}
