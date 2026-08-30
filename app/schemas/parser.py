from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


ParserTarget = Literal["material", "water"]
CrmStatusValue = Literal["parsed", "in_progress", "agreed", "hidden"]
PointKind = Literal["quarry", "water"]

MATERIAL_KEYWORDS = {
    "карьер": "quarry",
    "накопитель": "accumulator",
    "песок": "quarry",
    "щебень": "quarry",
    "пгс": "quarry",
    "песчано-гравийная смесь": "quarry",
}
WATER_KEYWORDS = {
    "вода",
    "питьевая вода",
    "техническая вода",
}


def normalize_parser_keyword(value: str) -> str:
    return " ".join(value.casefold().strip().split())


class ParserRunRequest(BaseModel):
    city: str = Field(min_length=1, max_length=200)
    center_lat: float = Field(ge=-90, le=90)
    center_lon: float = Field(ge=-180, le=180)
    radius_m: int = Field(ge=100, le=50000)
    target: ParserTarget
    keyword: str = Field(min_length=1, max_length=100)

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("keyword")
    @classmethod
    def normalize_keyword(cls, value: str) -> str:
        return normalize_parser_keyword(value)

    @model_validator(mode="after")
    def validate_target_keyword(self):
        if self.target == "material" and self.keyword not in MATERIAL_KEYWORDS:
            raise ValueError("Для материалов разрешены только карьерные ключевые слова")
        if self.target == "water" and self.keyword not in WATER_KEYWORDS:
            raise ValueError("Для воды разрешены только ключевые слова воды")
        return self


class ParserRunResult(BaseModel):
    found: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    cross_target_conflicts: int = 0
    truncated: bool = False


class CrmUpdateRequest(BaseModel):
    crm_status: CrmStatusValue | None = None
    crm_comment: str | None = Field(default=None, max_length=5000)

    model_config = ConfigDict(str_strip_whitespace=True)


class PointOwnerBindingRequest(BaseModel):
    owner_user_id: UUID


class CrmPointOut(BaseModel):
    id: UUID
    point_kind: PointKind
    owner_user_id: UUID | None = None
    crm_status: CrmStatusValue
    crm_comment: str | None = None


class PointAuditLogOut(BaseModel):
    id: UUID
    point_id: UUID
    point_kind: PointKind
    admin_id: UUID | None = None
    old_status: CrmStatusValue | None = None
    new_status: CrmStatusValue
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
