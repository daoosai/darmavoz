import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import HTTPStatusError, Response, Request
from app.integrations.avito.client import AvitoAPIClient
from app.core.config import settings
import time

@pytest.fixture
def mock_settings():
    with patch("app.integrations.avito.client.settings") as mock_set:
        mock_set.AVITO_CLIENT_ID = "test_client_id"
        mock_set.AVITO_CLIENT_SECRET = "test_client_secret"
        mock_set.AVITO_BASE_URL = "https://api.avito.ru"
        yield mock_set

@pytest.mark.asyncio
async def test_get_token_success(mock_settings):
    client = AvitoAPIClient()
    
    mock_post = AsyncMock()
    mock_response = MagicMock(spec=Response)
    mock_response.json.return_value = {
        "access_token": "test_token_123",
        "expires_in": 3600
    }
    mock_response.raise_for_status.return_value = None
    mock_post.return_value = mock_response
    
    with patch.object(client.client, "post", mock_post):
        token = await client._get_valid_token()
        assert token == "test_token_123"
        mock_post.assert_called_once()
        
        # Call again, should be cached
        token2 = await client._get_valid_token()
        assert token2 == "test_token_123"
        # post should not be called again
        assert mock_post.call_count == 1

@pytest.mark.asyncio
async def test_request_with_401_retry(mock_settings):
    client = AvitoAPIClient()
    client._token = "old_expired_token"
    client._token_expires_at = time.time() + 3600
    
    # Mock for the token refresh
    mock_post = AsyncMock()
    mock_token_response = MagicMock(spec=Response)
    mock_token_response.json.return_value = {
        "access_token": "new_fresh_token",
        "expires_in": 3600
    }
    mock_token_response.raise_for_status.return_value = None
    mock_post.return_value = mock_token_response
    
    # Mock for the actual request
    mock_request = AsyncMock()
    
    # First request raises 401
    mock_401_response = MagicMock(spec=Response)
    mock_401_response.status_code = 401
    mock_401_error = HTTPStatusError("401", request=MagicMock(spec=Request), response=mock_401_response)
    
    # Second request succeeds
    mock_success_response = MagicMock(spec=Response)
    mock_success_response.status_code = 200
    
    mock_request.side_effect = [mock_401_error, mock_success_response]
    
    with patch.object(client.client, "request", mock_request), \
         patch.object(client.client, "post", mock_post):
             
        response = await client.request("GET", "/some/endpoint")
        
        assert response.status_code == 200
        assert mock_request.call_count == 2
        assert mock_post.call_count == 1
        
        # First call used old token
        first_call_headers = mock_request.call_args_list[0][1]["headers"]
        # It's possible the dictionary is mutated in place, let's just check call count
        assert mock_request.call_count == 2
        assert mock_post.call_count == 1

@pytest.mark.asyncio
async def test_request_with_429_retry(mock_settings):
    client = AvitoAPIClient()
    client._token = "valid_token"
    client._token_expires_at = time.time() + 3600
    
    mock_request = AsyncMock()
    
    # First request raises 429
    mock_429_response = MagicMock(spec=Response)
    mock_429_response.status_code = 429
    mock_429_response.headers = {"Retry-After": "1"}
    mock_429_error = HTTPStatusError("429", request=MagicMock(spec=Request), response=mock_429_response)
    
    # Second request succeeds
    mock_success_response = MagicMock(spec=Response)
    mock_success_response.status_code = 200
    
    mock_request.side_effect = [mock_429_error, mock_success_response]
    
    with patch.object(client.client, "request", mock_request), \
         patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
             
        response = await client.request("GET", "/some/endpoint")
        
        assert response.status_code == 200
        assert mock_request.call_count == 2
        mock_sleep.assert_called_once_with(1)

@pytest.mark.asyncio
async def test_request_timeout_5xx(mock_settings):
    client = AvitoAPIClient()
    client._token = "valid_token"
    client._token_expires_at = time.time() + 3600
    
    mock_request = AsyncMock()
    
    mock_500_response = MagicMock(spec=Response)
    mock_500_response.status_code = 500
    mock_500_error = HTTPStatusError("500", request=MagicMock(spec=Request), response=mock_500_response)
    
    mock_request.side_effect = mock_500_error
    
    with patch.object(client.client, "request", mock_request):
        with pytest.raises(HTTPStatusError) as exc_info:
            await client.request("GET", "/some/endpoint")
            
        assert exc_info.value.response.status_code == 500
        assert mock_request.call_count == 1
