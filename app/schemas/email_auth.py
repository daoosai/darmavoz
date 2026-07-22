from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


EmailAuthScope = Literal["client", "user", "supplier"]


def _normalize_email_value(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        raise ValueError("Email обязателен")
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise ValueError("Некорректный формат email")
    local_part, _, domain = normalized.partition("@")
    if not local_part or "." not in domain:
        raise ValueError("Некорректный формат email")
    return normalized


class EmailSendCodeRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    auth_scope: EmailAuthScope = "client"

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalize_email_value(value)


class EmailVerifyCodeRequest(EmailSendCodeRequest):
    code: str = Field(min_length=4, max_length=8)


class EmailSendCodeResponse(BaseModel):
    ok: bool = True
    status: str = "email_sent"
    email: str
    is_new_user: bool | None = None


class EmailAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    client_id: UUID | None = None
    driver_id: UUID | None = None
