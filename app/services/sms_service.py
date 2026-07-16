import logging
import secrets

import httpx

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")
FALLBACK_OTP_CODE = "0000"
SMSRU_SEND_URL = "https://sms.ru/sms/send"


def generate_otp_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def normalize_sms_phone(phone_number: str) -> str:
    sms_phone = phone_number.replace("+", "").strip()
    if len(sms_phone) == 10:
        sms_phone = "7" + sms_phone
    elif len(sms_phone) == 11 and sms_phone.startswith("8"):
        sms_phone = "7" + sms_phone[1:]
    return sms_phone


async def send_auth_sms_code(*, phone_number: str, code: str, log_prefix: str) -> str:
    if not settings.USE_REAL_SMS:
        logger.info(
            "%s_sandbox_sms phone=%s code=%s",
            log_prefix,
            phone_number,
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    api_key = settings.SMSRU_API_KEY
    if not api_key:
        logger.warning(
            "%s_not_configured_fallback phone=%s fallback_code=%s",
            log_prefix,
            phone_number,
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    payload = {
        "api_id": api_key,
        "to": phone_number,
        "msg": f"{code} — код для входа в приложение Дармавоз. Никому не сообщайте код.",
        "json": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(SMSRU_SEND_URL, params=payload)
            response.raise_for_status()
    except httpx.HTTPError:
        logger.warning(
            "%s_request_failed_fallback phone=%s fallback_code=%s",
            log_prefix,
            phone_number,
            FALLBACK_OTP_CODE,
            exc_info=True,
        )
        return FALLBACK_OTP_CODE

    try:
        response_data = response.json()
    except ValueError:
        logger.warning(
            "%s_invalid_response_fallback phone=%s body=%s fallback_code=%s",
            log_prefix,
            phone_number,
            response.text[:500],
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    if not isinstance(response_data, dict):
        logger.warning(
            "%s_invalid_payload_fallback phone=%s response=%s fallback_code=%s",
            log_prefix,
            phone_number,
            response_data,
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    if response_data.get("status") != "OK":
        logger.warning(
            "%s_gateway_error_fallback phone=%s response=%s fallback_code=%s",
            log_prefix,
            phone_number,
            response_data,
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    sms_status = (response_data.get("sms") or {}).get(phone_number)
    if not isinstance(sms_status, dict) or str(sms_status.get("status")) != "OK":
        logger.warning(
            "%s_delivery_status_fallback phone=%s response=%s fallback_code=%s",
            log_prefix,
            phone_number,
            response_data,
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    return code
