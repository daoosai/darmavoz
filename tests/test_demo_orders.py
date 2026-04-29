import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.models.models import Client, Order, Role, User
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token

pytestmark = pytest.mark.asyncio


async def create_user_and_token(session_factory) -> str:
    async with session_factory() as session:
        role = Role(name=f"demo_role_{uuid.uuid4().hex[:8]}", description="Demo role")
        user = User(
            username=f"demo_user_{uuid.uuid4().hex[:8]}",
            hashed_password=get_password_hash("demo-password"),
            role=role,
            is_active=True,
        )
        session.add_all([role, user])
        await session.commit()
        return create_access_token(data={"sub": user.username})


async def test_orders_list_requires_auth(client: AsyncClient):
    response = await client.get("/api/v1/orders/")

    assert response.status_code == 401


async def test_orders_list_returns_latest_10_orders(client: AsyncClient, session_factory):
    token = await create_user_and_token(session_factory)
    base_created_at = datetime.now(timezone.utc)

    async with session_factory() as session:
        client_entity = Client(
            name="Demo Client",
            phone=f"+79{uuid.uuid4().int % 10**9:09d}",
            external_source="avito",
            external_user_id=f"demo_{uuid.uuid4().hex[:8]}",
        )
        session.add(client_entity)
        await session.flush()

        for index in range(12):
            session.add(
                Order(
                    client_id=client_entity.id,
                    status="draft" if index % 2 == 0 else "pending",
                        material=f"Material {index}",
                    volume=float(index + 1),
                        address=f"Address {index}",
                    notes=f"Summary: demo {index}",
                        created_at=base_created_at + timedelta(minutes=index),
                )
            )

        await session.commit()

    response = await client.get(
        "/api/v1/orders/",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 10
    assert data[0]["material"] == "Material 11"
    assert data[-1]["material"] == "Material 2"
    assert all("created_at" in item for item in data)


async def test_demo_static_page_is_available(client: AsyncClient):
    response = await client.get("/demo")

    assert response.status_code == 200
    assert "DEMO: Авито + ИИ обработка заказов" in response.text
