import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy import select
from app.integrations.avito.management import AvitoManagementService
from app.integrations.avito.client import AvitoAPIClient
from app.models.models import IntegrationEvent

@pytest.mark.asyncio
async def test_register_webhook_success(session_factory):
    mock_client = AsyncMock(spec=AvitoAPIClient)
    
    mock_response = MagicMock()
    mock_response.json.return_value = {"ok": True}
    mock_client.request.return_value = mock_response
    
    with patch("app.integrations.avito.management.settings.AVITO_WEBHOOK_URL_TOKEN", "token123"):
        async with session_factory() as db_session:
            service = AvitoManagementService(client=mock_client, session=db_session)
            
            result = await service.register_webhook("https://example.com/webhook")
            
            assert result["status"] == "success"
            assert result["webhook_id"] == "webhook_subscription:https://example.com/webhook?token=token123"
            assert result["webhook_url"] == "https://example.com/webhook?token=token123"
            
            mock_client.request.assert_called_once_with(
                "POST",
                "/messenger/v3/webhook",
                json={"url": "https://example.com/webhook?token=token123"}
            )
            
            stmt = select(IntegrationEvent).where(
                IntegrationEvent.external_event_id == "webhook_subscription:https://example.com/webhook?token=token123"
            )
            res = await db_session.execute(stmt)
            event = res.scalar_one_or_none()
            
            assert event is not None
            assert event.status == "processed"
            assert event.external_event_id == "webhook_subscription:https://example.com/webhook?token=token123"

@pytest.mark.asyncio
async def test_register_webhook_fail(session_factory):
    mock_client = AsyncMock(spec=AvitoAPIClient)
    
    mock_client.request.side_effect = Exception("API connection error")
    
    with patch("app.integrations.avito.management.settings.AVITO_WEBHOOK_URL_TOKEN", "token123"):
        async with session_factory() as db_session:
            service = AvitoManagementService(client=mock_client, session=db_session)
            
            with pytest.raises(Exception, match="API connection error"):
                await service.register_webhook("https://example.com/webhook")
                
            stmt = select(IntegrationEvent).where(
                IntegrationEvent.external_event_id == "registration_failure_https://example.com/webhook?token=token123"
            )
            res = await db_session.execute(stmt)
            event = res.scalar_one_or_none()
            
            assert event is not None
            assert event.status == "failed"
            assert event.error_message == "API connection error"
            assert "registration_failure_" in event.external_event_id


@pytest.mark.asyncio
async def test_register_webhook_repeat_is_idempotent(session_factory):
    mock_client = AsyncMock(spec=AvitoAPIClient)

    mock_response = MagicMock()
    mock_response.json.return_value = {"ok": True}
    mock_client.request.return_value = mock_response

    with patch("app.integrations.avito.management.settings.AVITO_WEBHOOK_URL_TOKEN", "token123"):
        async with session_factory() as db_session:
            service = AvitoManagementService(client=mock_client, session=db_session)

            first = await service.register_webhook("https://example.com/webhook")
            second = await service.register_webhook("https://example.com/webhook")

            assert first["status"] == "success"
            assert second["status"] == "success"
            assert first["webhook_id"] == second["webhook_id"]

            stmt = select(IntegrationEvent).where(
                IntegrationEvent.external_event_id == "webhook_subscription:https://example.com/webhook?token=token123"
            )
            res = await db_session.execute(stmt)
            events = res.scalars().all()

            assert len(events) == 1
            assert mock_client.request.call_count == 2
