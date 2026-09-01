from uuid import UUID

from pydantic import BaseModel, Field


class BulkDeleteRequest(BaseModel):
    point_ids: list[UUID] = Field(min_length=1, max_length=200)


class BulkDeleteResult(BaseModel):
    deleted_count: int
