from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str
    SECRET_KEY: str
    ALGORITHM: str
    ADMIN_USERNAME: str
    ADMIN_PASSWORD: str
    AVITO_WEBHOOK_SECRET: str
    AVITO_WEBHOOK_HEADER_NAME: str = "X-Webhook-Secret"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
