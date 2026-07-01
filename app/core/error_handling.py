import logging
import secrets
import string
from collections.abc import Iterable
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

ERROR_CODE_LENGTH = 6
ERROR_CODE_ALPHABET = string.ascii_uppercase + string.digits
CUSTOM_ERROR_STATUSES = {
    status.HTTP_400_BAD_REQUEST,
    status.HTTP_404_NOT_FOUND,
    status.HTTP_409_CONFLICT,
    status.HTTP_422_UNPROCESSABLE_ENTITY,
}

DETAIL_TRANSLATIONS = {
    "address not found": "Адрес не найден",
    "client not found": "Клиент не найден",
    "delivery option not found": "Тип машины не найден",
    "delivery rate is not configured": "Для выбранного типа машины не настроена ставка за километр",
    "driver not found": "Водитель не найден",
    "invalid response from 2gis geocoder": "Сервис 2ГИС временно вернул некорректный ответ",
    "invalid response from 2gis router": "Сервис 2ГИС временно вернул некорректный ответ",
    "material not found": "Материал не найден",
    "material price is not configured": "Для выбранного материала не настроена цена",
    "no active quarry found for material": "Для выбранного материала не найден активный карьер",
    "order not found": "Заказ не найден",
    "quarry not found": "Карьер не найден",
    "quarry not found for material": "Для выбранного материала не найден карьер",
    "route not found": "Маршрут не найден",
    "twogis_api_key is not configured": "Сервис карт временно недоступен",
    "2gis geocoder is unavailable": "Сервис 2ГИС временно недоступен",
    "2gis router is unavailable": "Сервис 2ГИС временно недоступен",
}

DEFAULT_STATUS_DETAILS = {
    status.HTTP_400_BAD_REQUEST: "Запрос содержит некорректные данные",
    status.HTTP_404_NOT_FOUND: "Запрошенные данные не найдены",
    status.HTTP_409_CONFLICT: "Конфликт данных. Проверьте корректность введенных значений",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "Проверьте корректность заполнения полей запроса",
}


def generate_error_code() -> str:
    return "".join(secrets.choice(ERROR_CODE_ALPHABET) for _ in range(ERROR_CODE_LENGTH))


def _stringify_validation_errors(items: Iterable[Any]) -> str:
    messages: list[str] = []
    for item in items:
        if isinstance(item, dict):
            loc = item.get("loc")
            msg = item.get("msg")
            if isinstance(loc, (list, tuple)) and isinstance(msg, str):
                field_name = ".".join(str(part) for part in loc if part not in {"body", "query", "path"})
                messages.append(f"{field_name}: {msg}" if field_name else msg)
                continue
            if isinstance(msg, str):
                messages.append(msg)
                continue
        if isinstance(item, str):
            messages.append(item)
    if not messages:
        return DEFAULT_STATUS_DETAILS[status.HTTP_422_UNPROCESSABLE_ENTITY]
    return "; ".join(messages[:3])


def _extract_detail_text(detail: Any) -> str:
    if isinstance(detail, str):
        return detail.strip()
    if isinstance(detail, dict):
        for key in ("message", "detail", "msg", "error"):
            value = detail.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""
    if isinstance(detail, list):
        return _stringify_validation_errors(detail)
    return ""


def _translate_detail(detail: Any, status_code: int) -> str:
    raw_detail = _extract_detail_text(detail)
    normalized_detail = raw_detail.lower()

    if any(token in normalized_detail for token in ("users_username_key", "drivers_phone_key", "duplicate key", "already exists")):
        return "Пользователь с таким номером уже зарегистрирован"
    if any(token in normalized_detail for token in ("inactive", "blocked", "suspended", "deactivated")):
        return "Ваш профиль заблокирован. Обратитесь в поддержку."

    translated = DETAIL_TRANSLATIONS.get(normalized_detail)
    if translated:
        return translated

    if raw_detail and any("а" <= ch.lower() <= "я" for ch in raw_detail):
        return raw_detail

    return DEFAULT_STATUS_DETAILS.get(status_code, "Произошла ошибка при обработке запроса")


def _error_response(status_code: int, detail: Any, *, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error_code": generate_error_code(),
            "detail": _translate_detail(detail, status_code),
        },
        headers=headers,
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def request_validation_exception_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        del request
        return _error_response(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.errors())

    @app.exception_handler(IntegrityError)
    async def integrity_exception_handler(
        request: Request,
        exc: IntegrityError,
    ) -> JSONResponse:
        del request
        logger.exception("integrity_error", exc_info=exc)
        return _error_response(status.HTTP_409_CONFLICT, str(exc.orig) or str(exc))

    @app.exception_handler(HTTPException)
    async def http_exception_handler(
        request: Request,
        exc: HTTPException,
    ) -> JSONResponse:
        del request
        if exc.status_code in CUSTOM_ERROR_STATUSES:
            return _error_response(exc.status_code, exc.detail, headers=exc.headers)

        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception(
            "unhandled_exception",
            extra={"path": str(request.url.path)},
            exc_info=exc,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error_code": generate_error_code(),
                "detail": "Внутренняя ошибка сервера. Сообщите код ошибки в поддержку.",
            },
        )
