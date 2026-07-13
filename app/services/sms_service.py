import logging
import secrets

import httpx

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")
FALLBACK_OTP_CODE = "0000"


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
    login = settings.SMSC_LOGIN
    password = settings.SMSC_PASSWORD
    if not login or not password:
        logger.warning(
            "%s_not_configured_fallback phone=%s fallback_code=%s",
            log_prefix,
            phone_number,
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    payload = {
        "login": login,
        "psw": password,
        "phones": phone_number,
        "mes": f"Код авторизации Дармавоз: {code}",
        "fmt": 3,
        "charset": "utf-8",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get("https://smsc.ru/sys/send.php", params=payload)
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

    if "error" in response_data:
        logger.warning(
            "%s_gateway_error_fallback phone=%s error_code=%s error=%s response=%s fallback_code=%s",
            log_prefix,
            phone_number,
            response_data.get("error_code"),
            response_data.get("error"),
            response_data,
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    if "id" not in response_data:
        logger.warning(
            "%s_missing_message_id_fallback phone=%s response=%s fallback_code=%s",
            log_prefix,
            phone_number,
            response_data,
            FALLBACK_OTP_CODE,
        )
        return FALLBACK_OTP_CODE

    return code
