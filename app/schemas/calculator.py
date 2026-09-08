from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CalculatorMaterial(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    bulk_density_t_m3: float | None


class CalculatorCapacity(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    capacity_m3: float


class CalculatorReferences(BaseModel):
    materials: list[CalculatorMaterial]
    delivery_options: list[CalculatorCapacity]
