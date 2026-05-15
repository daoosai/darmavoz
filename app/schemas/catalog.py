import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict


# =====================================================================================
# Category Schemas
# =====================================================================================

class CategoryOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    sort_order: int
    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)


# =====================================================================================
# Material Schemas
# =====================================================================================

class MaterialCreate(BaseModel):
    name: str
    description: Optional[str] = None
    price: Optional[float] = None
    unit: str
    min_volume: float = 1.0
    image_url: Optional[str] = None
    category_id: uuid.UUID
    is_active: bool = True

class MaterialUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    unit: Optional[str] = None
    min_volume: Optional[float] = None
    image_url: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None

class MaterialOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    price: Optional[float]
    unit: str
    min_volume: float
    image_url: Optional[str]
    category_id: uuid.UUID
    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)


# =====================================================================================
# Cart Schemas
# =====================================================================================

class CartItemCreate(BaseModel):
    material_id: uuid.UUID
    volume: float


class CartItemUpdate(BaseModel):
    volume: float

class CartItemOut(BaseModel):
    id: uuid.UUID
    material_id: uuid.UUID
    volume: float
    unit_price: Optional[float]
    amount: Optional[float]
    material: MaterialOut

    model_config = ConfigDict(from_attributes=True)
