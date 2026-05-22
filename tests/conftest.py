import asyncio
import os
import sys
import uuid
from typing import AsyncGenerator

# Добавляем корневую директорию проекта в sys.path до любых импортов из app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from main import app
from app.core.config import settings
from app.db.database import get_db

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALEMBIC_INI_PATH = os.path.join(PROJECT_ROOT, "alembic.ini")
ALEMBIC_SCRIPT_LOCATION = os.path.join(PROJECT_ROOT, "alembic")
test_db_name = f"darmavoz_test_db_{uuid.uuid4().hex[:8]}"

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
    try:
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

        alembic_cfg = Config(ALEMBIC_INI_PATH)
        alembic_cfg.set_main_option("script_location", ALEMBIC_SCRIPT_LOCATION)
        alembic_cfg.set_main_option("sqlalchemy.url", test_database_url.render_as_string(hide_password=False))

        await asyncio.to_thread(command.upgrade, alembic_cfg, "head")

        yield
    finally:
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
async def admin_token(session_factory) -> str:
    from app.models.models import Role, User
    from app.security.auth import get_password_hash
    from app.security.jwt import create_access_token
    from sqlalchemy import select
    async with session_factory() as session:
        result = await session.execute(select(Role).where(Role.name == "admin"))
        role = result.scalar_one_or_none()
        if not role:
            role = Role(name="admin", description="Admin role")
            session.add(role)
        
        user = User(
            username=f"admin_{uuid.uuid4().hex[:8]}",
            hashed_password=get_password_hash("admin-password"),
            role=role,
            is_active=True
        )
        session.add(user)
        await session.commit()
        return create_access_token(data={"sub": user.username})


@pytest.fixture
def session_factory():
    return TestingSessionLocal
