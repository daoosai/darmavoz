from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TransportCategoryOut(BaseModel):
    id: UUID
    slug: str
    title: str
    capacity_min_m3: float
    capacity_max_m3: float | None = None
    is_active: bool
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class TransportCategoryCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    title: str = Field(min_length=1, max_length=255)
    capacity_min_m3: float = Field(gt=0)
    capacity_max_m3: float | None = Field(default=None, gt=0)
    is_active: bool = True
    sort_order: int = 0

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_capacity_range(self):
        if self.capacity_max_m3 is not None and self.capacity_max_m3 < self.capacity_min_m3:
            raise ValueError("capacity_max_m3 must be greater than or equal to capacity_min_m3")
        return self


class TransportCategoryUpdate(BaseModel):
    slug: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    title: str | None = Field(default=None, min_length=1, max_length=255)
    capacity_min_m3: float | None = Field(default=None, gt=0)
    capacity_max_m3: float | None = Field(default=None, gt=0)
    is_active: bool | None = None
    sort_order: int | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class DeliveryTariffOut(BaseModel):
    id: UUID
    city_id: UUID
    transport_category_id: UUID
    distance_from_km: float
    distance_to_km: float | None = None
    rate_per_km: float
    min_price_quarry: float
    min_price_warehouse: float
    is_active: bool
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class DeliveryTariffCreate(BaseModel):
    city_id: UUID
    distance_from_km: float = Field(ge=0)
    distance_to_km: float | None = Field(default=None, gt=0)
    rate_per_km: float = Field(ge=0)
    min_price_quarry: float = Field(ge=0)
    min_price_warehouse: float = Field(ge=0)
    is_active: bool = True
    sort_order: int = 0

    @model_validator(mode="after")
    def validate_distance_range(self):
        if self.distance_to_km is not None and self.distance_to_km <= self.distance_from_km:
            raise ValueError("distance_to_km must be greater than distance_from_km")
        return self


class DeliveryTariffUpdate(BaseModel):
    distance_from_km: float | None = Field(default=None, ge=0)
    distance_to_km: float | None = Field(default=None, gt=0)
    rate_per_km: float | None = Field(default=None, ge=0)
    min_price_quarry: float | None = Field(default=None, ge=0)
    min_price_warehouse: float | None = Field(default=None, ge=0)
    is_active: bool | None = None
    sort_order: int | None = None

