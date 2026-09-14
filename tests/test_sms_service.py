import pytest
from fastapi import HTTPException

from app.core.config import settings

from app.services.sms_service import (
    EMAIL_COOLDOWN_SECONDS,
    OTP_LOCK_SECONDS,
    SANDBOX_OTP_CODE,
    enforce_email_rate_limit,
    enforce_sms_rate_limit,
    mask_email,
    send_auth_sms_code,
    validate_email_otp,
    validate_sms_otp,
    verify_sms_otp_code,
)
from app.utils.phones import normalize_otp_phone


class RateLimitRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttl_by_key: dict[str, int] = {}

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.values[key] = value
        self.ttl_by_key[key] = ttl

    async def set(self, key: str, value: str, *, ex: int, nx: bool = False) -> bool:
        if nx and key in self.values:
            return False
        self.values[key] = value
        self.ttl_by_key[key] = ex
        return True

    async def incr(self, key: str) -> int:
        value = int(self.values.get(key, "0")) + 1
        self.values[key] = str(value)
        return value

    async def expire(self, key: str, ttl: int) -> bool:
        if key not in self.values:
            return False
        self.ttl_by_key[key] = ttl
        return True

    async def delete(self, key: str) -> None:
        self.values.pop(key, None)
        self.ttl_by_key.pop(key, None)


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


@pytest.mark.asyncio
async def test_sms_rate_limit_and_otp_lock_after_three_bad_attempts():
    redis = RateLimitRedis()
    phone = "+79995550123"
    otp_key = f"otp:client:{normalize_otp_phone(phone)}"

    await enforce_sms_rate_limit(redis, phone)
    with pytest.raises(HTTPException) as cooldown_error:
        await enforce_sms_rate_limit(redis, phone)
    assert cooldown_error.value.status_code == 429

    await redis.delete(f"ratelimit:sms_cooldown:{normalize_otp_phone(phone)}")
    await redis.setex(otp_key, 300, "123456")
    for _ in range(2):
        assert not await validate_sms_otp(
            redis=redis,
            phone_number=phone,
            otp_key=otp_key,
            submitted_code="000000",
            stored_code="123456",
        )

    with pytest.raises(HTTPException) as lock_error:
        await validate_sms_otp(
            redis=redis,
            phone_number=phone,
            otp_key=otp_key,
            submitted_code="000000",
            stored_code="123456",
        )
    assert lock_error.value.status_code == 429
    assert otp_key not in redis.values
    assert redis.ttl_by_key[f"otp_lock:{normalize_otp_phone(phone)}"] == OTP_LOCK_SECONDS


def test_real_sms_rejects_sandbox_code(monkeypatch):
    monkeypatch.setattr(settings, "USE_REAL_SMS", True)

    assert not verify_sms_otp_code(submitted_code=SANDBOX_OTP_CODE, stored_code=SANDBOX_OTP_CODE)
    assert verify_sms_otp_code(submitted_code="7289", stored_code="7289")


@pytest.mark.asyncio
async def test_email_rate_limit_and_otp_lock_after_three_bad_attempts():
    redis = RateLimitRedis()
    email = "darmavoz@example.com"
    otp_key = f"otp:email:client:{email}"

    await enforce_email_rate_limit(redis, email)
    assert redis.ttl_by_key[f"ratelimit:email_cooldown:{email}"] == EMAIL_COOLDOWN_SECONDS
    with pytest.raises(HTTPException) as cooldown_error:
        await enforce_email_rate_limit(redis, email)
    assert cooldown_error.value.status_code == 429

    await redis.setex(otp_key, 300, "1234")
    for _ in range(2):
        assert not await validate_email_otp(
            redis=redis,
            email=email,
            otp_key=otp_key,
            submitted_code="0000",
            stored_code="1234",
        )

    with pytest.raises(HTTPException) as lock_error:
        await validate_email_otp(
            redis=redis,
            email=email,
            otp_key=otp_key,
            submitted_code="0000",
            stored_code="1234",
        )
    assert lock_error.value.status_code == 429
    assert otp_key not in redis.values
    assert redis.ttl_by_key[f"email_otp_lock:{email}"] == OTP_LOCK_SECONDS


def test_mask_email_hides_local_part():
    assert mask_email("darmavoz@example.com") == "d***z@example.com"
