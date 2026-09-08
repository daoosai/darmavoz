from uuid import UUID
from pydantic import BaseModel, Field


class PartnerRegisterRequest(BaseModel):
    city_ids: list[UUID] | None = Field(default=None, min_length=1)
    phone: str = Field(min_length=10, max_length=20)


class PartnerVerifyCodeRequest(BaseModel):
    city_ids: list[UUID] | None = Field(default=None, min_length=1)
    phone: str = Field(min_length=10, max_length=20)
    code: str = Field(min_length=4, max_length=8)


class PartnerRegistrationOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class PartnerSmsChallengeOut(BaseModel):
    status: str = "sms_sent"
    phone: str
