import os
import sys
from typing import AsyncGenerator

# Добавляем корневую директорию проекта в sys.path до любых импортов из app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from main import app
from app.core.config import settings
from app.db.database import get_db
from app.models.models import Base

test_db_name = "darmavoz_test_db"

# Строим URL через SQLAlchemy, чтобы менять только имя базы, а не другие части строки.
base_url = make_url(settings.DATABASE_URL)
default_database_url = base_url.set(database="postgres")
test_database_url = base_url.set(database=test_db_name)

# Подключаемся к системной базе postgres, чтобы оттуда создать тестовую БД.
default_engine = create_async_engine(
    default_database_url,
    isolation_level="AUTOCOMMIT",
    poolclass=NullPool,
)

# Движок для работы с самой тестовой базой.
engine_test = create_async_engine(test_database_url, poolclass=NullPool)
TestingSessionLocal = async_sessionmaker(engine_test, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def prepare_database() -> AsyncGenerator[None, None]:
    """
    Создает и удаляет тестовую базу данных для сессии тестов.
    """
    async with default_engine.connect() as conn:
        await conn.execute(
            text(
                "SELECT pg_terminate_backend(pid) "
                "FROM pg_stat_activity "
                "WHERE datname = :db_name AND pid <> pg_backend_pid()"
            ),
            {"db_name": test_db_name},
        )
        await conn.execute(text(f"DROP DATABASE IF EXISTS {test_db_name}"))
        await conn.execute(text(f"CREATE DATABASE {test_db_name}"))

    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    await engine_test.dispose()

    async with default_engine.connect() as conn:
        await conn.execute(
            text(
                "SELECT pg_terminate_backend(pid) "
                "FROM pg_stat_activity "
                "WHERE datname = :db_name AND pid <> pg_backend_pid()"
            ),
            {"db_name": test_db_name},
        )
        await conn.execute(text(f"DROP DATABASE IF EXISTS {test_db_name}"))

    await default_engine.dispose()


async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with TestingSessionLocal() as session:
        yield session


@pytest.fixture
def session_factory():
    return TestingSessionLocal
