from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CityCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False, extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    region: str = Field(min_length=1, max_length=255)
    code: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64)
    center_lat: float = Field(ge=-90, le=90)
    center_lon: float = Field(ge=-180, le=180)
    map_zoom: float = Field(ge=1, le=20)
    min_lat: float = Field(ge=-90, le=90)
    min_lon: float = Field(ge=-180, le=180)
    max_lat: float = Field(ge=-90, le=90)
    max_lon: float = Field(ge=-180, le=180)
    sort_order: int = 0

    @model_validator(mode="after")
    def validate_bounds(self):
        if not (self.min_lat < self.max_lat and self.min_lon < self.max_lon):
            raise ValueError("Некорректные границы поиска")
        if not (self.min_lat <= self.center_lat <= self.max_lat and self.min_lon <= self.center_lon <= self.max_lon):
            raise ValueError("Центр карты должен находиться в области поиска")
        return self


class CityOut(CityCreate):
    model_config = ConfigDict(from_attributes=True, allow_inf_nan=False)
    id: UUID
    is_active: bool
    is_default: bool


class CityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str | None = None
    region: str | None = None
    code: str | None = None
    center_lat: float | None = None
    center_lon: float | None = None
    map_zoom: float | None = None
    min_lat: float | None = None
    min_lon: float | None = None
    max_lat: float | None = None
    max_lon: float | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    is_default: bool | None = None

    @model_validator(mode="after")
    def reject_null(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Поля города не могут быть null")
        return self
