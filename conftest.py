import os


# Unit-test collection must not depend on a deployment .env file. A real
# DATABASE_URL supplied by CI still takes precedence for integration tests.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/postgres",
)
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/0")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("ALGORITHM", "HS256")
os.environ.setdefault("ADMIN_USERNAME", "test-admin")
os.environ.setdefault("ADMIN_PASSWORD", "test-admin-password")
os.environ.setdefault("AVITO_WEBHOOK_SECRET", "test-webhook-secret")


from tests.conftest import (  # noqa: E402,F401
    admin_token,
    client,
    prepare_database,
    session_factory,
)
