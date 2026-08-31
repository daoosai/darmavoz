import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.sms_service import SANDBOX_OTP_CODE, send_auth_sms_code, verify_sms_otp_code
from app.utils.phones import normalize_otp_phone


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


@pytest.mark.parametrize(
    "phone",
    ["+7 (999) 555-01-23", "8 999 555 01 23", "79995550123", "9995550123"],
)
def test_normalize_otp_phone_uses_single_redis_format(phone):
    assert normalize_otp_phone(phone) == "79995550123"


def test_real_sms_rejects_sandbox_code(monkeypatch):
    monkeypatch.setattr(settings, "USE_REAL_SMS", True)

    assert not verify_sms_otp_code(submitted_code=SANDBOX_OTP_CODE, stored_code=SANDBOX_OTP_CODE)
    assert verify_sms_otp_code(submitted_code="7289", stored_code="7289")
