from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WholesaleInput(BaseModel):
    city_id: UUID
    material_id: UUID | None = None
    material_name: str = Field(min_length=1, max_length=255)
    volume: Decimal = Field(gt=0, le=999999999, decimal_places=3)
    unit: Literal["m3", "t"] = "m3"
    vehicle_count: int = Field(gt=0, le=100000)
    pickup_address: str = Field(min_length=3, max_length=500)
    delivery_address: str = Field(min_length=3, max_length=500)
    starts_on: date
    ends_on: date
    price: Decimal = Field(gt=0, le=99999999999, decimal_places=2)
    price_basis: Literal["m3", "t", "vehicle", "total"] = "m3"
    contact_name: str = Field(min_length=1, max_length=255)
    contact_phone: str = Field(min_length=10, max_length=30, pattern=r"^\+?[0-9 ()-]+$")
    comment: str | None = Field(default=None, max_length=5000)

    @field_validator("material_name", "pickup_address", "delivery_address", "contact_name")
    @classmethod
    def non_blank(cls, value):
        if not value.strip():
            raise ValueError("Поле не может быть пустым")
        return value.strip()

    @field_validator("contact_phone")
    @classmethod
    def valid_phone(cls, value):
        digits = "".join(char for char in value if char.isdigit())
        if not 10 <= len(digits) <= 15:
            raise ValueError("Проверьте контактный телефон")
        return ("+" if value.startswith("+") else "") + digits

    @model_validator(mode="after")
    def dates(self):
        if self.ends_on < self.starts_on:
            raise ValueError("Проверьте даты")
        return self


class WholesaleOut(WholesaleInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    author_id: UUID
    status: str
    moderation_reason: str | None
    created_at: datetime
    updated_at: datetime
    is_favorite: bool = False
    is_owner: bool = False


class ModerationInput(BaseModel):
    action: Literal["publish", "reject", "hide"]
    reason: str | None = Field(default=None, max_length=2000)


class AccessInput(BaseModel):
    enabled: bool


class QuoteInput(BaseModel):
    amount: Decimal = Field(gt=0, le=99999999999, decimal_places=2)
    material_amount: Decimal = Field(ge=0, le=99999999999, decimal_places=2)
    delivery_amount: Decimal = Field(ge=0, le=99999999999, decimal_places=2)

    @model_validator(mode="after")
    def totals(self):
        if self.amount != self.material_amount + self.delivery_amount:
            raise ValueError("Сумма позиций должна совпадать с итогом")
        return self


class RefundInput(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)

    @field_validator("reason")
    @classmethod
    def non_blank(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("Укажите причину")
        return value.strip()


class PaymentInput(BaseModel):
    email: str | None = Field(default=None, max_length=255)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        import re
        if value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Укажите корректную почту для чека")
        return value
