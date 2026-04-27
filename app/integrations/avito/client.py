import logging
import time
import asyncio
from typing import Optional, Dict, Any
from httpx import AsyncClient, HTTPStatusError, Response

from app.core.config import settings

logger = logging.getLogger(__name__)

class AvitoAPIClient:
    def __init__(self):
        self.client = AsyncClient(base_url=settings.AVITO_BASE_URL)
        self._token: Optional[str] = None
        self._token_expires_at: float = 0.0

    async def _get_token(self) -> str:
        if not settings.AVITO_CLIENT_ID or not settings.AVITO_CLIENT_SECRET:
            raise ValueError("Avito client credentials not configured")
        
        try:
            response = await self.client.post(
                "/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": settings.AVITO_CLIENT_ID,
                    "client_secret": settings.AVITO_CLIENT_SECRET
                }
            )
            response.raise_for_status()
            token_data = response.json()
            
            self._token = token_data["access_token"]
            self._token_expires_at = time.time() + token_data["expires_in"] - 60  # 60s buffer
            
            logger.info("avito_token_requested", extra={"expires_in": token_data["expires_in"]})
            return self._token
        except HTTPStatusError as e:
            logger.error("avito_api_error", extra={"endpoint": "/token", "error": str(e)})
            raise

    async def _get_valid_token(self) -> str:
        if not self._token or time.time() >= self._token_expires_at:
            return await self._get_token()
        return self._token

    async def request(self, method: str, endpoint: str, **kwargs) -> Response:
        token = await self._get_valid_token()
        
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {token}"
        
        logger.info("avito_api_request", extra={"method": method, "endpoint": endpoint})
        
        try:
            response = await self.client.request(method, endpoint, headers=headers, **kwargs)
            response.raise_for_status()
            return response
        except HTTPStatusError as e:
            if e.response.status_code == 401:
                # Token might be invalid, retry once
                self._token = None
                token = await self._get_valid_token()
                headers["Authorization"] = f"Bearer {token}"
                
                response = await self.client.request(method, endpoint, headers=headers, **kwargs)
                response.raise_for_status()
                return response
            elif e.response.status_code == 429:
                retry_after = int(e.response.headers.get("Retry-After", 5))
                logger.warning("avito_api_rate_limit", extra={"retry_after": retry_after})
                await asyncio.sleep(retry_after)
                return await self.request(method, endpoint, headers=headers, **kwargs)
            
            logger.error("avito_api_error", extra={"method": method, "endpoint": endpoint, "error": str(e)})
            raise
    
    async def aclose(self):
        await self.client.aclose()
