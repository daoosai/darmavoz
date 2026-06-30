from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class QuarryMaterialRef(BaseModel):
    id: UUID
    name: str
    unit: str
    price: float | None = None

    model_config = ConfigDict(from_attributes=True)


class QuarryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=1000)
    lat: float
    lon: float
    is_active: bool = True
    material_ids: list[UUID] = Field(default_factory=list)

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("lat")
    @classmethod
    def validate_lat(cls, value: float) -> float:
        if value < -90 or value > 90:
            raise ValueError("Latitude must be between -90 and 90")
        return value

    @field_validator("lon")
    @classmethod
    def validate_lon(cls, value: float) -> float:
        if value < -180 or value > 180:
            raise ValueError("Longitude must be between -180 and 180")
        return value

    @field_validator("material_ids")
    @classmethod
    def normalize_material_ids(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


class QuarryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = Field(default=None, min_length=1, max_length=1000)
    lat: float | None = None
    lon: float | None = None
    is_active: bool | None = None
    material_ids: list[UUID] | None = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("lat")
    @classmethod
    def validate_lat(cls, value: float | None) -> float | None:
        if value is None:
            return value
        if value < -90 or value > 90:
            raise ValueError("Latitude must be between -90 and 90")
        return value

    @field_validator("lon")
    @classmethod
    def validate_lon(cls, value: float | None) -> float | None:
        if value is None:
            return value
        if value < -180 or value > 180:
            raise ValueError("Longitude must be between -180 and 180")
        return value

    @field_validator("material_ids")
    @classmethod
    def normalize_material_ids(cls, value: list[UUID] | None) -> list[UUID] | None:
        if value is None:
            return None
        return list(dict.fromkeys(value))


class QuarryOut(BaseModel):
    id: UUID
    name: str
    address: str
    lat: float
    lon: float
    is_active: bool
    material_ids: list[UUID] = Field(default_factory=list)
    materials: list[QuarryMaterialRef] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
