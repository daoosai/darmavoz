from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str
    SECRET_KEY: str
    ALGORITHM: str
    ADMIN_USERNAME: str
    ADMIN_PASSWORD: str
    LOGIST_USERNAME: str | None = None
    LOGIST_PASSWORD: str | None = None
    MANAGER_USERNAME: str | None = None
    MANAGER_PASSWORD: str | None = None
    AVITO_WEBHOOK_SECRET: str
    AVITO_WEBHOOK_HEADER_NAME: str = "X-Webhook-Secret"
    AVITO_WEBHOOK_URL_TOKEN: str | None = None
    AVITO_WEBHOOK_ALLOWED_IPS: str = ""

    # Avito API Integration
    AVITO_CLIENT_ID: str | None = None
    AVITO_CLIENT_SECRET: str | None = None
    AVITO_ACCOUNT_ID: str | None = None
    AVITO_BASE_URL: str = "https://api.avito.ru"
    LLM_API_KEY: str | None = None
    LLM_BASE_URL: str = "https://api.proxyapi.ru/openai/v1"
    LLM_MODEL: str = "gpt-4o-mini"
    LLM_TIMEOUT_SECONDS: int = 30
    LLM_MAX_RETRIES: int = 3
    LLM_TEMPERATURE: float = 0.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def avito_webhook_allowed_ips_set(self) -> set[str]:
        return {
            item.strip()
            for item in self.AVITO_WEBHOOK_ALLOWED_IPS.split(",")
            if item.strip()
        }

settings = Settings()
