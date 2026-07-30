from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SupplierProfileOut(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    display_name: Optional[str] = None


class SupplierProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=255)

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: Optional[str]) -> Optional[str]:
        return value or None


class AdminSupplierPointOut(BaseModel):
    id: UUID
    name: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class AdminSupplierOut(BaseModel):
    id: UUID
    role: Literal["supplier", "equipment_owner"] = "supplier"
    full_name: Optional[str] = None
    phone: str
    is_active: bool
    pickup_points: list[AdminSupplierPointOut] = Field(default_factory=list)
    active_point_names: list[str] = Field(default_factory=list)
    active_equipment_names: list[str] = Field(default_factory=list)


class AdminSupplierUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, min_length=10, max_length=20)
    is_active: Optional[bool] = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("full_name")
    @classmethod
    def normalize_full_name(cls, value: Optional[str]) -> Optional[str]:
        return value or None

    @model_validator(mode="after")
    def require_update(self):
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        return self
