import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from sqlalchemy import select
from app.integrations.avito.management import AvitoManagementService
from app.integrations.avito.client import AvitoAPIClient
from app.models.models import IntegrationEvent

@pytest.fixture
def mock_settings():
    with patch("app.integrations.avito.management.settings") as mock_set:
        mock_set.AVITO_ACCOUNT_ID = "test_account_id"
        yield mock_set

@pytest.mark.asyncio
async def test_register_webhook_success(session_factory, mock_settings):
    mock_client = AsyncMock(spec=AvitoAPIClient)
    
    mock_response = MagicMock()
    mock_response.json.return_value = {"webhook_id": "test_wh_123"}
    mock_client.request.return_value = mock_response
    
    async with session_factory() as db_session:
        service = AvitoManagementService(client=mock_client, session=db_session)
        
        result = await service.register_webhook("https://example.com/webhook")
        
        assert result["status"] == "success"
        assert result["webhook_id"] == "test_wh_123"
        
        mock_client.request.assert_called_once_with(
            "POST",
            "/messenger/v3/accounts/test_account_id/webhooks",
            json={"url": "https://example.com/webhook", "events": ["message_new"]}
        )
        
        # Check DB for IntegrationEvent
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_wh_123")
        res = await db_session.execute(stmt)
        event = res.scalar_one_or_none()
        
        assert event is not None
        assert event.status == "processed"
        assert event.external_event_id == "test_wh_123"

@pytest.mark.asyncio
async def test_register_webhook_fail(session_factory, mock_settings):
    mock_client = AsyncMock(spec=AvitoAPIClient)
    
    mock_client.request.side_effect = Exception("API connection error")
    
    async with session_factory() as db_session:
        service = AvitoManagementService(client=mock_client, session=db_session)
        
        with pytest.raises(Exception, match="API connection error"):
            await service.register_webhook("https://example.com/webhook")
            
        # Check DB for IntegrationEvent
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "registration_failure_https://example.com/webhook")
        res = await db_session.execute(stmt)
        event = res.scalar_one_or_none()
        
        assert event is not None
        assert event.status == "failed"
        assert event.error_message == "API connection error"
        assert "registration_failure_" in event.external_event_id
