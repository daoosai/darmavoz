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
    S3_ENABLED: bool = False
    S3_ENDPOINT: str | None = None
    S3_REGION: str = "us-east-1"
    S3_BUCKET: str = "darmavoz-media"
    S3_ACCESS_KEY: str | None = None
    S3_SECRET_KEY: str | None = None
    S3_USE_SSL: bool = False
    S3_USE_PATH_STYLE: bool = True
    S3_PUBLIC_BASE_URL: str | None = None
    S3_PRESIGN_ENDPOINT: str | None = None
    S3_PRESIGN_TTL_SECONDS: int = 900
    S3_PREFIX: str = "prod"
    MEDIA_MAX_FILE_SIZE_BYTES: int = 10485760
    DISPATCH_POLL_INTERVAL_SECONDS: int = 5
    DISPATCH_OFFER_TIMEOUT_SECONDS: int = 120
    DISPATCH_DECLINE_PENALTY_SECONDS: int = 900
    DISPATCH_TIMEOUT_PENALTY_SECONDS: int = 1800
    DISPATCH_LOCK_TTL_SECONDS: int = 30
    DRIVER_TEST_USERNAME: str = "driver1"
    DRIVER_TEST_PASSWORD: str = "driver123"
    ANDROID_VERSION: str = "1.7.0"
    APK_DOWNLOAD_URL: str = "https://darmavoz.ru/static/darmavoz.apk"
    APK_FORCE_UPDATE: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def avito_webhook_allowed_ips_set(self) -> set[str]:
        return {
            item.strip()
            for item in self.AVITO_WEBHOOK_ALLOWED_IPS.split(",")
            if item.strip()
        }

    @property
    def s3_public_base_url(self) -> str:
        if not self.S3_PUBLIC_BASE_URL:
            return ""
        return self.S3_PUBLIC_BASE_URL.rstrip("/") + "/"

settings = Settings()
