from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TelemetryErrorIn(BaseModel):
    error_code: str | None = Field(default=None, max_length=32)
    user_id: UUID | None = None
    message: str = Field(min_length=1, max_length=4000)
    payload: Any = None

    model_config = ConfigDict(str_strip_whitespace=True, extra="allow")


class TelemetryErrorOut(BaseModel):
    ok: bool
    error_log_id: UUID
