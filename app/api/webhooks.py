import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.integrations.avito.schemas import AvitoWebhookPayload
from app.integrations.avito.service import AvitoWebhookService

router = APIRouter(tags=["Webhooks"])
logger = logging.getLogger(__name__)


def verify_webhook_secret(
    request: Request,
    x_webhook_secret: str | None = Header(default=None, alias=settings.AVITO_WEBHOOK_HEADER_NAME),
) -> str:
    provided_secret = x_webhook_secret or ""
    expected_secret = settings.AVITO_WEBHOOK_SECRET or ""

    if not secrets.compare_digest(provided_secret, expected_secret):
        logger.warning(
            "invalid_webhook_secret",
            extra={
                "path": str(request.url.path),
                "client_host": request.client.host if request.client else None,
                "header_name": settings.AVITO_WEBHOOK_HEADER_NAME,
            },
        )
        raise HTTPException(status_code=403, detail="Invalid secret")

    return provided_secret


@router.post("/avito", dependencies=[Depends(verify_webhook_secret)])
async def avito_webhook(
    payload: AvitoWebhookPayload,
    session: AsyncSession = Depends(get_db)
) -> dict[str, str | bool]:
    """
    Эндпоинт для приема вебхуков от Авито.
    Принимает строго типизированный payload и передает в сервис обработки.
    """
    try:
        service = AvitoWebhookService()
        await service.process_inbound_webhook(session, payload)
        return {"ok": True, "status": "processed"}
    except Exception:
        logger.exception(
            "webhook_processing_error",
            extra={
                "source": "avito",
                "external_event_id": payload.event_id,
                "account_id": payload.account_id,
            },
        )
        raise HTTPException(status_code=500, detail="Internal processing error")
