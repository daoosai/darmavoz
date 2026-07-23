from unittest.mock import Mock

import pytest

from app.services import sms_service


class DummyAsyncClient:
    def __init__(self, response):
        self._response = response
        self.calls: list[tuple[str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, data):
        self.calls.append((url, data))
        return self._response


@pytest.mark.asyncio
async def test_send_auth_sms_code_uses_smsru_payload(monkeypatch):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "status": "OK",
        "status_code": 100,
        "sms": {
            "79990000001": {
                "status": "OK",
                "status_code": 100,
                "sms_id": "12345",
            }
        },
    }

    client = DummyAsyncClient(response)

    monkeypatch.setattr(sms_service.settings, "USE_REAL_SMS", True)
    monkeypatch.setattr(sms_service.settings, "SMSRU_API_KEY", "test-api-key")
    monkeypatch.setattr(sms_service.httpx, "AsyncClient", lambda timeout: client)

    result = await sms_service.send_auth_sms_code(
        phone_number="79990000001",
        code="1234",
        log_prefix="test_sms_auth",
    )

    assert result == "1234"
    assert client.calls == [
        (
            sms_service.SMSRU_SEND_URL,
            {
                "api_id": "test-api-key",
                "to": "79990000001",
                "msg": "1234 — код для входа в приложение Дармавоз. Никому не сообщайте код.",
                "from": "DARMAVOZ.RU",
                "json": 1,
            },
        )
    ]


@pytest.mark.asyncio
async def test_send_auth_sms_code_accepts_json_status_100(monkeypatch):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "status": "OK",
        "status_code": 100,
        "sms": {
            "79990000001": {
                "status": "OK",
                "status_code": 100,
                "sms_id": "67890",
            }
        },
    }

    monkeypatch.setattr(sms_service.settings, "USE_REAL_SMS", True)
    monkeypatch.setattr(sms_service.settings, "SMSRU_API_KEY", "test-api-key")
    monkeypatch.setattr(
        sms_service.httpx,
        "AsyncClient",
        lambda timeout: DummyAsyncClient(response),
    )

    result = await sms_service.send_auth_sms_code(
        phone_number="79990000001",
        code="5678",
        log_prefix="test_sms_auth",
    )

    assert result == "5678"


@pytest.mark.asyncio
async def test_send_auth_sms_code_returns_fallback_for_non_100_status(monkeypatch):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "status": "OK",
        "status_code": 100,
        "sms": {
            "79990000001": {
                "status": "ERROR",
                "status_code": 201,
                "status_text": "Invalid sender",
            }
        },
    }

    monkeypatch.setattr(sms_service.settings, "USE_REAL_SMS", True)
    monkeypatch.setattr(sms_service.settings, "SMSRU_API_KEY", "test-api-key")
    monkeypatch.setattr(
        sms_service.httpx,
        "AsyncClient",
        lambda timeout: DummyAsyncClient(response),
    )

    result = await sms_service.send_auth_sms_code(
        phone_number="79990000001",
        code="5678",
        log_prefix="test_sms_auth",
    )

    assert result == sms_service.FALLBACK_OTP_CODE
