import logging
import secrets
from typing import NoReturn

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")
SANDBOX_OTP_CODE = "0000"
SMSRU_SEND_URL = "https://sms.ru/sms/send"
SMSRU_SENDER = "DARMAVOZ.RU"
SMS_DELIVERY_ERROR_DETAIL = "Не удалось отправить SMS-код. Попробуйте ещё раз."


def generate_otp_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def raise_sms_delivery_error() -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=SMS_DELIVERY_ERROR_DETAIL,
    )


def normalize_sms_phone(phone_number: str) -> str:
    digits = "".join(ch for ch in phone_number if ch.isdigit())
    if len(digits) == 10 and digits.startswith("9"):
        return "7" + digits
    if len(digits) == 11 and digits.startswith("8"):
        return "7" + digits[1:]
    if len(digits) == 11 and digits.startswith("7"):
        return digits
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Некорректный номер телефона",
    )


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
