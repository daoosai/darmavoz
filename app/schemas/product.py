from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ProductResponse(BaseModel):
    id: UUID
    name: str
    description: str
    price: float
    unit_type: str
    image_url: str

    model_config = ConfigDict(from_attributes=True)
