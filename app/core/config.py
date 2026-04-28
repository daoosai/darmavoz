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
    AVITO_WEBHOOK_URL_TOKEN: str | None = None
    AVITO_WEBHOOK_ALLOWED_IPS: str = ""
    
    # Avito API Integration
    AVITO_CLIENT_ID: str | None = None
    AVITO_CLIENT_SECRET: str | None = None
    AVITO_ACCOUNT_ID: str | None = None
    AVITO_BASE_URL: str = "https://api.avito.ru"
    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_TIMEOUT_SECONDS: int = 30
    OPENAI_MAX_RETRIES: int = 3
    OPENAI_TEMPERATURE: float = 0.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def avito_webhook_allowed_ips_set(self) -> set[str]:
        return {
            item.strip()
            for item in self.AVITO_WEBHOOK_ALLOWED_IPS.split(",")
            if item.strip()
        }

settings = Settings()
