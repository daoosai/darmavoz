import logging
from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import IntegrationEvent
from app.integrations.avito.client import AvitoAPIClient
from app.core.config import settings

logger = logging.getLogger(__name__)

class AvitoManagementService:
    def __init__(self, client: AvitoAPIClient, session: AsyncSession):
        self.client = client
        self.session = session

    async def register_webhook(self, webhook_url: str) -> Dict[str, Any]:
        if not settings.AVITO_ACCOUNT_ID:
            raise ValueError("Avito account ID not configured")
        
        endpoint = f"/messenger/v3/accounts/{settings.AVITO_ACCOUNT_ID}/webhooks"
        
        try:
            response = await self.client.request(
                "POST",
                endpoint,
                json={"url": webhook_url, "events": ["message_new"]}
            )
            data = response.json()
            webhook_id = data.get("webhook_id", "unknown")
            
            event = IntegrationEvent(
                source="avito",
                external_event_id=webhook_id,
                payload=data,
                status="processed",
                # removed invalid event_type keyword argument
            )
            self.session.add(event)
            await self.session.commit()
            
            logger.info("avito_webhook_registered", extra={"webhook_url": webhook_url, "webhook_id": webhook_id})
            return {"status": "success", "webhook_id": webhook_id}
            
        except Exception as e:
            event = IntegrationEvent(
                source="avito",
                external_event_id=f"registration_failure_{webhook_url}",
                payload={"webhook_url": webhook_url, "error": str(e)},
                status="failed",
                error_message=str(e)
            )
            self.session.add(event)
            await self.session.commit()
            
            logger.error("avito_webhook_registration_failed", extra={"webhook_url": webhook_url, "error": str(e)})
            raise
