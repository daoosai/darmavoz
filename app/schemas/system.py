from pydantic import BaseModel


class SystemVersionOut(BaseModel):
    android_version: str
    download_url: str
    force_update: bool
