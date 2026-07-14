from uuid import UUID

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.storage import normalize_public_url


class MediaFileOut(BaseModel):
    id: UUID
    entity_type: str
    entity_id: UUID
    bucket: str
    object_key: str
    public_url: str
    content_type: str
    file_name: str
    file_size: int
    sort_order: int | None = None
    slot_key: str | None = None
    is_primary: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("public_url")
    @classmethod
    def normalize_media_public_url(cls, value: str) -> str:
        normalized = normalize_public_url(value)
        return normalized or value


class CategoryOut(BaseModel):
    id: UUID
    name: str
    slug: str
    sort_order: int
    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)


class MaterialCreate(BaseModel):
    name: str
    description: str | None = None
    price: float | None = None
    unit: str
    min_volume: float = 1.0
    image_url: str | None = None
    category_id: UUID
    is_active: bool = True
    sort_order: int = 0


class MaterialUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    price: float | None = None
    unit: str | None = None
    min_volume: float | None = None
    image_url: str | None = None
    category_id: UUID | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class DeliveryOptionOut(BaseModel):
    id: UUID
    capacity_m3: float
    title: str
    description: str | None = None
    base_price: float | None = None
    delivery_rate_per_km: float | None = None
    min_delivery_price: float = 5000.0
    is_active: bool
    sort_order: int
    image_url: str | None = None
    primary_image_url: str | None = None
    media_files: list[MediaFileOut] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

    @field_validator("image_url", "primary_image_url")
    @classmethod
    def normalize_delivery_image_urls(cls, value: str | None) -> str | None:
        return normalize_public_url(value)


class MaterialOut(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    price: float | None = None
    unit: str
    min_volume: float
    image_url: str | None = None
    category_id: UUID
    is_active: bool = True
    sort_order: int = 0
    primary_image_url: str | None = None
    media_files: list[MediaFileOut] = Field(default_factory=list)
    delivery_options: list[DeliveryOptionOut] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

    @field_validator("image_url", "primary_image_url")
    @classmethod
    def normalize_material_image_urls(cls, value: str | None) -> str | None:
        return normalize_public_url(value)


class CartItemCreate(BaseModel):
    material_id: UUID
    quarry_id: UUID | None = None
    volume: float


class CartItemUpdate(BaseModel):
    volume: float


class CartItemOut(BaseModel):
    id: UUID
    material_id: UUID
    quarry_id: UUID | None = None
    pickup_point_name: str | None = None
    pickup_point_type: str | None = None
    volume: float
    unit_price: float | None = None
    amount: float | None = None
    material: MaterialOut

    model_config = ConfigDict(from_attributes=True)


class DeliveryOptionCreate(BaseModel):
    capacity_m3: float
    title: str
    description: str | None = None
    base_price: float | None = None
    delivery_rate_per_km: float | None = None
    min_delivery_price: float = 5000.0
    is_active: bool = True
    sort_order: int = 0

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="before")
    @classmethod
    def accept_name_alias(cls, data):
        if isinstance(data, dict) and "title" not in data and "name" in data:
            data = dict(data)
            data["title"] = data["name"]
        return data


class DeliveryOptionUpdate(BaseModel):
    capacity_m3: float | None = None
    title: str | None = None
    description: str | None = None
    base_price: float | None = None
    delivery_rate_per_km: float | None = None
    min_delivery_price: float | None = None
    is_active: bool | None = None
    sort_order: int | None = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="before")
    @classmethod
    def accept_name_alias(cls, data):
        if isinstance(data, dict) and "title" not in data and "name" in data:
            data = dict(data)
            data["title"] = data["name"]
        return data
