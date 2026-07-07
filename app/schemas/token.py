from typing import Optional
from uuid import UUID
from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: str
    role: str | None = None
    driver_id: UUID | None = None


class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None
    client_id: UUID | None = None
