from pydantic import BaseModel, ConfigDict, Field, field_validator


class SupplierProfileOut(BaseModel):
    phone: str
    display_name: str | None = None


class SupplierProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=255)

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        return value or None
