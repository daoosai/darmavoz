import logging
import secrets
from ipaddress import ip_address

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.integrations.avito.schemas import AvitoWebhookPayload
from app.integrations.avito.service import AvitoWebhookService

router = APIRouter(tags=["Webhooks"])
logger = logging.getLogger(__name__)


def get_request_source_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        parts = [part.strip() for part in forwarded_for.split(",") if part.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else None


def is_ip_allowed(ip_value: str | None) -> bool:
    if not ip_value:
        return False
    try:
        normalized = str(ip_address(ip_value))
    except ValueError:
        return False
    return normalized in settings.avito_webhook_allowed_ips_set


def verify_webhook_secret(
    request: Request,
    x_webhook_secret: str | None = Header(default=None, alias=settings.AVITO_WEBHOOK_HEADER_NAME),
) -> str | None:
    provided_secret = x_webhook_secret or ""
    expected_secret = settings.AVITO_WEBHOOK_SECRET or ""
    provided_token = request.query_params.get("token", "")
    expected_token = settings.AVITO_WEBHOOK_URL_TOKEN or ""
    source_ip = get_request_source_ip(request)

    if expected_token and secrets.compare_digest(provided_token, expected_token):
        return provided_token

    if expected_secret and provided_secret and secrets.compare_digest(provided_secret, expected_secret):
        return provided_secret

    if settings.avito_webhook_allowed_ips_set and is_ip_allowed(source_ip):
        return source_ip

    logger.warning(
        "invalid_webhook_auth",
        extra={
            "path": str(request.url.path),
            "client_host": request.client.host if request.client else None,
            "source_ip": source_ip,
            "header_name": settings.AVITO_WEBHOOK_HEADER_NAME,
            "header_present": bool(provided_secret),
            "token_present": bool(provided_token),
            "ip_allowlist_configured": bool(settings.avito_webhook_allowed_ips_set),
        },
    )
    if expected_token or expected_secret or settings.avito_webhook_allowed_ips_set:
        logger.warning(
            "webhook_auth_rejected",
            extra={"source_ip": source_ip},
        )
        raise HTTPException(status_code=403, detail="Invalid webhook authentication")

    return None


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
