import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.sms_service import SANDBOX_OTP_CODE, send_auth_sms_code


@pytest.mark.asyncio
async def test_sms_uses_sandbox_code_only_when_real_sms_is_disabled(monkeypatch):
    monkeypatch.setattr(settings, "USE_REAL_SMS", False)

    stored_code = await send_auth_sms_code(
        phone_number="79995550123",
        code="1234",
        log_prefix="test_sms",
    )

    assert stored_code == SANDBOX_OTP_CODE


@pytest.mark.asyncio
async def test_sms_fails_closed_when_real_sms_is_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "USE_REAL_SMS", True)
    monkeypatch.setattr(settings, "SMSRU_API_KEY", None)

    with pytest.raises(HTTPException) as exc_info:
        await send_auth_sms_code(
            phone_number="79995550123",
            code="1234",
            log_prefix="test_sms",
        )

    assert exc_info.value.status_code == 503
