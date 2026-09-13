import logging
import secrets
from typing import NoReturn

import httpx
from fastapi import HTTPException, status
from redis.asyncio import Redis

from app.core.config import settings
from app.utils.phones import normalize_otp_phone

logger = logging.getLogger("uvicorn.error")
SANDBOX_OTP_CODE = "0000"
SMSRU_SEND_URL = "https://sms.ru/sms/send"
SMSRU_SENDER = "DARMAVOZ.RU"
SMS_DELIVERY_ERROR_DETAIL = "Не удалось отправить SMS-код. Попробуйте ещё раз."
SMS_COOLDOWN_SECONDS = 60
SMS_HOURLY_LIMIT = 5
SMS_HOURLY_WINDOW_SECONDS = 60 * 60
OTP_MAX_ATTEMPTS = 3
OTP_LOCK_SECONDS = 15 * 60


def generate_otp_code() -> str:
    minimum_code = 1 if settings.USE_REAL_SMS else 0
    return f"{secrets.randbelow(10000 - minimum_code) + minimum_code:04d}"


def verify_sms_otp_code(*, submitted_code: str, stored_code: str) -> bool:
    if settings.USE_REAL_SMS and submitted_code == SANDBOX_OTP_CODE:
        return False
    return secrets.compare_digest(submitted_code, stored_code)


def _phone_rate_limit_suffix(phone_number: str) -> str:
    return normalize_otp_phone(phone_number)


async def enforce_sms_rate_limit(redis: Redis, phone_number: str) -> None:
    """Limit SMS sends per phone without persisting unauthenticated users."""
    suffix = _phone_rate_limit_suffix(phone_number)
    lock_key = f"otp_lock:{suffix}"
    cooldown_key = f"ratelimit:sms_cooldown:{suffix}"
    hourly_key = f"ratelimit:sms_hourly:{suffix}"

    if await redis.get(lock_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много неверных попыток. Попробуйте через 15 минут.",
        )
    if await redis.get(cooldown_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Повторная отправка возможна через минуту.",
        )

    try:
        hourly_count = int(await redis.get(hourly_key) or "0")
    except (TypeError, ValueError):
        hourly_count = 0
    if hourly_count >= SMS_HOURLY_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Превышен лимит SMS для этого номера. Попробуйте позже.",
        )

    await redis.setex(cooldown_key, SMS_COOLDOWN_SECONDS, "1")
    # A rolling one-hour window is deliberately stricter than a fixed window.
    await redis.setex(hourly_key, SMS_HOURLY_WINDOW_SECONDS, str(hourly_count + 1))


async def validate_sms_otp(
    *,
    redis: Redis,
    phone_number: str,
    otp_key: str,
    submitted_code: str,
    stored_code: str,
    additional_otp_keys: tuple[str, ...] = (),
) -> bool:
    """Validate OTP and invalidate it after three bad guesses."""
    suffix = _phone_rate_limit_suffix(phone_number)
    lock_key = f"otp_lock:{suffix}"
    attempts_key = f"otp_attempts:{suffix}"

    if await redis.get(lock_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много неверных попыток. Попробуйте через 15 минут.",
        )

    if verify_sms_otp_code(submitted_code=submitted_code, stored_code=stored_code):
        await redis.delete(attempts_key)
        return True

    try:
        attempts = int(await redis.get(attempts_key) or "0") + 1
    except (TypeError, ValueError):
        attempts = 1
    if attempts >= OTP_MAX_ATTEMPTS:
        for key in (otp_key, *additional_otp_keys, attempts_key):
            await redis.delete(key)
        await redis.setex(lock_key, OTP_LOCK_SECONDS, "1")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много неверных попыток. Попробуйте через 15 минут.",
        )

    await redis.setex(attempts_key, OTP_LOCK_SECONDS, str(attempts))
    return False


def raise_sms_delivery_error() -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=SMS_DELIVERY_ERROR_DETAIL,
    )


def normalize_sms_phone(phone_number: str) -> str:
    try:
        return normalize_otp_phone(phone_number)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Некорректный номер телефона",
        ) from exc


def mask_sms_phone(phone_number: str) -> str:
    if len(phone_number) <= 7:
        return phone_number
    return f"{phone_number[:4]}*****{phone_number[-2:]}"


def sanitize_smsru_response(response_data: object, phone_number: str) -> object:
    if not isinstance(response_data, dict):
        return response_data

    safe_response = dict(response_data)
    sms_section = safe_response.get("sms")
    if isinstance(sms_section, dict):
        masked_phone = mask_sms_phone(phone_number)
        safe_sms_section = {}
        for key, value in sms_section.items():
            safe_sms_section[masked_phone if key == phone_number else key] = value
        safe_response["sms"] = safe_sms_section
    return safe_response


async def send_auth_sms_code(*, phone_number: str, code: str, log_prefix: str) -> str:
    masked_phone = mask_sms_phone(phone_number)
    message = (
        f"{code} — код для входа в приложение Дармавоз. "
        "Никому не сообщайте код."
    )
    safe_message = message.replace(code, "****", 1)
    logger.info(
        "%s_send_attempt normalized_phone=%s sender=%s message=%r",
        log_prefix,
        masked_phone,
        SMSRU_SENDER,
        safe_message,
    )

    if not settings.USE_REAL_SMS:
        logger.info(
            "%s_sandbox_sms normalized_phone=%s",
            log_prefix,
            masked_phone,
        )
        return SANDBOX_OTP_CODE

    api_key = settings.SMSRU_API_KEY
    if not api_key:
        logger.warning(
            "%s_not_configured normalized_phone=%s",
            log_prefix,
            masked_phone,
        )
        raise_sms_delivery_error()

    payload = {
        "api_id": api_key,
        "to": phone_number,
        "msg": message,
        "from": SMSRU_SENDER,
        "json": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(SMSRU_SEND_URL, data=payload)
            response.raise_for_status()
    except httpx.HTTPError:
        logger.warning(
            "%s_request_failed normalized_phone=%s",
            log_prefix,
            masked_phone,
            exc_info=True,
        )
        raise_sms_delivery_error()

    try:
        response_data = response.json()
    except ValueError:
        logger.warning(
            "%s_invalid_response normalized_phone=%s body=%s",
            log_prefix,
            masked_phone,
            response.text[:500],
        )
        raise_sms_delivery_error()

    if not isinstance(response_data, dict):
        logger.warning(
            "%s_invalid_payload normalized_phone=%s response=%s",
            log_prefix,
            masked_phone,
            response_data,
        )
        raise_sms_delivery_error()

    safe_response = sanitize_smsru_response(response_data, phone_number)
    if response_data.get("status") != "OK":
        logger.warning(
            "%s_gateway_error normalized_phone=%s sender=%s smsru_status_code=%s response=%s",
            log_prefix,
            masked_phone,
            SMSRU_SENDER,
            response_data.get("status_code"),
            safe_response,
        )
        raise_sms_delivery_error()

    sms_status = (response_data.get("sms") or {}).get(phone_number)
    logger.info(
        "%s_gateway_response normalized_phone=%s sender=%s smsru_status_code=%s sms_id=%s response=%s",
        log_prefix,
        masked_phone,
        SMSRU_SENDER,
        (sms_status or {}).get("status_code", response_data.get("status_code")),
        (sms_status or {}).get("sms_id"),
        safe_response,
    )
    if not isinstance(sms_status, dict) or str(sms_status.get("status")) != "OK":
        logger.warning(
            "%s_delivery_status normalized_phone=%s sender=%s smsru_status_code=%s sms_id=%s response=%s",
            log_prefix,
            masked_phone,
            SMSRU_SENDER,
            (sms_status or {}).get("status_code", response_data.get("status_code")),
            (sms_status or {}).get("sms_id"),
            safe_response,
        )
        raise_sms_delivery_error()

    return code
