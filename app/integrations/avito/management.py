import logging
from typing import Dict, Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import IntegrationEvent
from app.integrations.avito.client import AvitoAPIClient
from app.core.config import settings

logger = logging.getLogger(__name__)

class AvitoManagementService:
    def __init__(self, client: AvitoAPIClient, session: AsyncSession):
        self.client = client
        self.session = session

    def _build_registration_webhook_url(self, webhook_url: str) -> str:
        token = settings.AVITO_WEBHOOK_URL_TOKEN or ""
        if not token:
            return webhook_url

        parts = urlsplit(webhook_url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["token"] = token
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

    async def _upsert_integration_event(
        self,
        *,
        external_event_id: str,
        payload: Dict[str, Any],
        status: str,
        error_message: str | None = None,
    ) -> None:
        stmt = (
            insert(IntegrationEvent)
            .values(
                source="avito",
                external_event_id=external_event_id,
                payload=payload,
                status=status,
                error_message=error_message,
            )
            .on_conflict_do_update(
                constraint="uix_integration_events_source_external_id",
                set_={
                    "payload": payload,
                    "status": status,
                    "error_message": error_message,
                },
            )
        )
        await self.session.execute(stmt)
        await self.session.commit()

    async def register_webhook(self, webhook_url: str) -> Dict[str, Any]:
        endpoint = "/messenger/v3/webhook"
        registration_url = self._build_registration_webhook_url(webhook_url)
        
        try:
            response = await self.client.request(
                "POST",
                endpoint,
                json={"url": registration_url}
            )
            data = response.json()
            webhook_id = data.get("webhook_id") or f"webhook_subscription:{registration_url}"

            await self._upsert_integration_event(
                external_event_id=webhook_id,
                payload={**data, "registered_url": registration_url},
                status="processed",
            )
            
            logger.info("avito_webhook_registered", extra={"webhook_url": registration_url, "webhook_id": webhook_id})
            return {"status": "success", "webhook_id": webhook_id, "webhook_url": registration_url}
            
        except Exception as e:
            await self.session.rollback()
            await self._upsert_integration_event(
                external_event_id=f"registration_failure_{registration_url}",
                payload={"webhook_url": registration_url, "error": str(e)},
                status="failed",
                error_message=str(e),
            )
            
            logger.error("avito_webhook_registration_failed", extra={"webhook_url": registration_url, "error": str(e)})
            raise
