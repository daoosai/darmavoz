import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models.models import Client, Driver, Role, User
from app.security.jwt import create_access_token


async def _create_user(session_factory, role_name: str) -> tuple[User, str]:
    async with session_factory() as session:
        role = await session.scalar(select(Role).where(Role.name == role_name))
        if role is None:
            role = Role(name=role_name, description=f"{role_name} role")
            session.add(role)
            await session.flush()
        user = User(
            username=f"{role_name}_{uuid.uuid4().hex[:8]}",
            hashed_password="not-used-in-token-tests",
            role_id=role.id,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user, create_access_token({"sub": user.username, "role": role_name})


async def _create_client(session_factory) -> tuple[Client, str]:
    async with session_factory() as session:
        suffix = str(uuid.uuid4().int)[-7:]
        client = Client(name="Тестовый клиент", phone=f"+7900{suffix}")
        session.add(client)
        await session.commit()
        await session.refresh(client)
        token = create_access_token(
            {"sub": client.phone, "role": "client", "client_id": str(client.id)}
        )
        return client, token


@pytest.mark.asyncio
async def test_equipment_catalog_application_and_operator_flow(
    client, session_factory, monkeypatch
):
    admin, admin_token = await _create_user(session_factory, "admin")
    _logist, logist_token = await _create_user(session_factory, "logist")
    customer, client_token = await _create_client(session_factory)
    notifications: list[uuid.UUID] = []
    monkeypatch.setattr(
        "app.api.equipment.schedule_equipment_application_notification",
        lambda application: notifications.append(application.id),
    )

    type_response = await client.post(
        "/api/v1/admin/equipment-types",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "Автокран", "is_active": True, "sort_order": 80},
    )
    assert type_response.status_code == 201
    type_id = type_response.json()["id"]

    listing_response = await client.post(
        "/api/v1/admin/equipment",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "equipment_type_id": type_id,
            "title": "Автокран 25 тонн",
            "description": "Работа по городу и району",
            "tariffs": [{"type": "hour", "price": 4500}],
            "city": "Тюмень",
            "district": "Центральный",
            "is_active": True,
            "sort_order": 10,
        },
    )
    assert listing_response.status_code == 201
    listing_id = listing_response.json()["id"]

    public_response = await client.get(
        "/api/v1/catalog/equipment", params={"city": "Тюмень", "search": "кран"}
    )
    assert public_response.status_code == 200
    assert [item["id"] for item in public_response.json()] == [listing_id]

    application_response = await client.post(
        "/api/v1/client/equipment-applications",
        headers={"Authorization": f"Bearer {client_token}"},
        json={
            "listing_id": listing_id,
            "object_address": "Тюмень, улица Республики, 1",
            "requested_date": str(date.today() + timedelta(days=1)),
            "requested_time": "10:30",
            "duration_value": 4,
            "duration_unit": "hours",
            "contact_phone": customer.phone,
            "comment": "Нужен длинный вылет стрелы",
        },
    )
    assert application_response.status_code == 201
    application_id = application_response.json()["id"]
    assert notifications == [uuid.UUID(application_id)]

    take_response = await client.patch(
        f"/api/v1/admin/equipment-applications/{application_id}/status",
        headers={"Authorization": f"Bearer {logist_token}"},
        json={"status": "in_progress"},
    )
    assert take_response.status_code == 200
    assert take_response.json()["status"] == "in_progress"

    close_response = await client.patch(
        f"/api/v1/admin/equipment-applications/{application_id}/status",
        headers={"Authorization": f"Bearer {logist_token}"},
        json={"status": "completed"},
    )
    assert close_response.status_code == 200
    assert close_response.json()["closed_at"] is not None


@pytest.mark.asyncio
async def test_support_history_permissions_and_close_flow(
    client, session_factory, monkeypatch
):
    customer, client_token = await _create_client(session_factory)
    _other_customer, other_token = await _create_client(session_factory)
    _logist, logist_token = await _create_user(session_factory, "logist")
    operator_notifications: list[tuple[uuid.UUID, bool]] = []
    monkeypatch.setattr(
        "app.api.support.schedule_support_operator_notification",
        lambda ticket_id, is_new: operator_notifications.append((ticket_id, is_new)),
    )
    monkeypatch.setattr(
        "app.api.support.schedule_support_reply_notification", lambda **kwargs: None
    )

    create_response = await client.post(
        "/api/v1/support/tickets",
        headers={"Authorization": f"Bearer {client_token}"},
        json={
            "subject": "Проблема с заказом",
            "category": "general",
            "context_type": "general",
            "message": "Нужна помощь оператора",
        },
    )
    assert create_response.status_code == 201
    ticket_id = create_response.json()["id"]
    assert create_response.json()["requester_name"] == customer.name
    assert operator_notifications == [(uuid.UUID(ticket_id), True)]

    forbidden_response = await client.get(
        f"/api/v1/support/tickets/{ticket_id}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert forbidden_response.status_code == 404

    reply_response = await client.post(
        f"/api/v1/admin/support/tickets/{ticket_id}/messages",
        headers={"Authorization": f"Bearer {logist_token}"},
        json={"text": "Здравствуйте, уже разбираемся."},
    )
    assert reply_response.status_code == 200
    assert reply_response.json()["status"] == "in_progress"
    assert len(reply_response.json()["messages"]) == 2

    close_response = await client.patch(
        f"/api/v1/admin/support/tickets/{ticket_id}/status",
        headers={"Authorization": f"Bearer {logist_token}"},
        json={"status": "closed"},
    )
    assert close_response.status_code == 200

    closed_message_response = await client.post(
        f"/api/v1/support/tickets/{ticket_id}/messages",
        headers={"Authorization": f"Bearer {client_token}"},
        json={"text": "Новое сообщение"},
    )
    assert closed_message_response.status_code == 409


@pytest.mark.asyncio
async def test_driver_can_create_support_ticket(client, session_factory, monkeypatch):
    driver_user, driver_token = await _create_user(session_factory, "driver")
    async with session_factory() as session:
        driver = Driver(
            name="Водитель поддержки",
            phone=f"+7999{str(uuid.uuid4().int)[-7:]}",
            user_id=driver_user.id,
            status="offline",
        )
        session.add(driver)
        await session.commit()
    monkeypatch.setattr(
        "app.api.support.schedule_support_operator_notification", lambda *args, **kwargs: None
    )

    response = await client.post(
        "/api/v1/support/tickets",
        headers={"Authorization": f"Bearer {driver_token}"},
        json={
            "subject": "Вопрос водителя",
            "category": "general",
            "context_type": "general",
            "message": "Не меняется статус заказа",
        },
    )
    assert response.status_code == 201
    assert response.json()["requester_role"] == "driver"
