import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models.models import Client, Driver, Role, SupportMessage, User
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
        "app.api.support.send_support_operator_notification",
        lambda ticket_id, is_new: operator_notifications.append((ticket_id, is_new)),
    )
    monkeypatch.setattr(
        "app.api.support.send_support_reply_notification", lambda **kwargs: None
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
        json={"text": "\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435"},
    )
    assert closed_message_response.status_code == 409


@pytest.mark.asyncio
async def test_driver_can_create_support_ticket(client, session_factory, monkeypatch):
    driver_user, driver_token = await _create_user(session_factory, "driver")
    async with session_factory() as session:
        driver = Driver(
            name="\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u044c \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0438",
            phone=f"+7999{str(uuid.uuid4().int)[-7:]}",
            user_id=driver_user.id,
            status="offline",
        )
        session.add(driver)
        await session.commit()
    monkeypatch.setattr(
        "app.api.support.send_support_operator_notification", lambda *args, **kwargs: None
    )

    response = await client.post(
        "/api/v1/support/tickets",
        headers={"Authorization": f"Bearer {driver_token}"},
        json={
            "subject": "\u0412\u043e\u043f\u0440\u043e\u0441 \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044f",
            "category": "general",
            "context_type": "general",
            "message": "\u041d\u0435 \u043c\u0435\u043d\u044f\u0435\u0442\u0441\u044f \u0441\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u043a\u0430\u0437\u0430",
        },
    )
    assert response.status_code == 201
    assert response.json()["requester_role"] == "driver"


@pytest.mark.asyncio
async def test_supplier_can_create_read_and_reply_in_support_ticket(
    client, session_factory, monkeypatch
):
    supplier_user, supplier_token = await _create_user(session_factory, "supplier")
    _logist, logist_token = await _create_user(session_factory, "logist")
    monkeypatch.setattr(
        "app.api.support.send_support_operator_notification", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "app.api.support.send_support_reply_notification", lambda **kwargs: None
    )

    create_response = await client.post(
        "/api/v1/support/tickets",
        headers={"Authorization": f"Bearer {supplier_token}"},
        json={
            "subject": "Вопрос по модерации",
            "category": "moderation_question",
            "context_type": "general",
            "message": "Почему объявление вернулось на доработку?",
        },
    )
    assert create_response.status_code == 201
    created_ticket = create_response.json()
    ticket_id = created_ticket["id"]
    assert created_ticket["requester_role"] == "supplier"
    assert created_ticket["messages"][0]["author_role"] == "supplier"

    list_response = await client.get(
        "/api/v1/support/tickets",
        headers={"Authorization": f"Bearer {supplier_token}"},
    )
    assert list_response.status_code == 200
    assert any(ticket["id"] == ticket_id for ticket in list_response.json())

    message_response = await client.post(
        f"/api/v1/support/tickets/{ticket_id}/messages",
        headers={"Authorization": f"Bearer {supplier_token}"},
        json={"text": "Добавил подробности по объявлению"},
    )
    assert message_response.status_code == 200
    assert message_response.json()["messages"][-1]["author_role"] == "supplier"

    operator_tickets_response = await client.get(
        "/api/v1/admin/support/tickets",
        headers={"Authorization": f"Bearer {logist_token}"},
    )
    assert operator_tickets_response.status_code == 200
    operator_ticket = next(
        ticket
        for ticket in operator_tickets_response.json()
        if ticket["id"] == ticket_id
    )
    assert operator_ticket["requester_role"] == "supplier"
    assert operator_ticket["requester_name"] == (
        supplier_user.display_name or supplier_user.username
    )


@pytest.mark.asyncio
async def test_operator_reply_sends_push_to_driver_ticket_author(
    client, session_factory, monkeypatch
):
    driver_user, driver_token = await _create_user(session_factory, "driver")
    _logist, logist_token = await _create_user(session_factory, "logist")
    async with session_factory() as session:
        driver = Driver(
            name="\u0412\u043e\u0434\u0438\u0442\u0435\u043b\u044c \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0438",
            phone=f"+7999{str(uuid.uuid4().int)[-7:]}",
            user_id=driver_user.id,
            status="offline",
        )
        session.add(driver)
        await session.commit()
        await session.refresh(driver)
        driver_id = driver.id

    monkeypatch.setattr(
        "app.api.support.send_support_operator_notification", lambda *args, **kwargs: None
    )
    reply_notifications: list[dict[str, uuid.UUID | None]] = []
    monkeypatch.setattr(
        "app.api.support.send_support_reply_notification",
        lambda **kwargs: reply_notifications.append(kwargs),
    )

    create_response = await client.post(
        "/api/v1/support/tickets",
        headers={"Authorization": f"Bearer {driver_token}"},
        json={
            "subject": "\u0412\u043e\u043f\u0440\u043e\u0441 \u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044f",
            "category": "general",
            "context_type": "general",
            "message": "\u041d\u0443\u0436\u043d\u0430 \u043f\u043e\u043c\u043e\u0449\u044c \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0430",
        },
    )
    assert create_response.status_code == 201
    ticket_id = create_response.json()["id"]

    reply_response = await client.post(
        f"/api/v1/admin/support/tickets/{ticket_id}/messages",
        headers={"Authorization": f"Bearer {logist_token}"},
        json={"text": "\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043d\u043e\u0432\u044b\u0439 \u0442\u0430\u0439\u043c\u0441\u043b\u043e\u0442"},
    )
    assert reply_response.status_code == 200
    assert reply_notifications == [
        {
            "ticket_id": uuid.UUID(ticket_id),
            "client_id": None,
            "driver_id": driver_id,
        }
    ]


@pytest.mark.asyncio
async def test_support_read_edit_and_delete_endpoints(client, session_factory, monkeypatch):
    customer, client_token = await _create_client(session_factory)
    _logist, logist_token = await _create_user(session_factory, "logist")
    monkeypatch.setattr(
        "app.api.support.send_support_operator_notification", lambda *args, **kwargs: None
    )
    monkeypatch.setattr("app.api.support.send_support_reply_notification", lambda **kwargs: None)

    create_response = await client.post(
        "/api/v1/support/tickets",
        headers={"Authorization": f"Bearer {client_token}"},
        json={
            "subject": "Редактирование обращения",
            "category": "general",
            "context_type": "general",
            "message": "Первое сообщение клиента",
        },
    )
    assert create_response.status_code == 201
    created_ticket = create_response.json()
    ticket_id = created_ticket["id"]
    client_message_id = created_ticket["messages"][0]["id"]

    reply_response = await client.post(
        f"/api/v1/admin/support/tickets/{ticket_id}/messages",
        headers={"Authorization": f"Bearer {logist_token}"},
        json={"text": "Ответ оператора"},
    )
    assert reply_response.status_code == 200
    operator_message = reply_response.json()["messages"][-1]
    assert operator_message["is_read"] is False

    read_response = await client.patch(
        f"/api/v1/support/tickets/{ticket_id}/read",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert read_response.status_code == 200
    read_messages = {message["id"]: message for message in read_response.json()["messages"]}
    assert read_messages[operator_message["id"]]["is_read"] is True

    edit_response = await client.patch(
        f"/api/v1/support/messages/{client_message_id}",
        headers={"Authorization": f"Bearer {client_token}"},
        json={"text": "Обновленный текст клиента"},
    )
    assert edit_response.status_code == 200
    edited_messages = {message["id"]: message for message in edit_response.json()["messages"]}
    assert edited_messages[client_message_id]["text"] == "Обновленный текст клиента"

    image_response = await client.post(
        f"/api/v1/support/tickets/{ticket_id}/messages",
        headers={"Authorization": f"Bearer {client_token}"},
        json={"attachment_url": "https://files.example.test/support/image.jpg"},
    )
    assert image_response.status_code == 200
    image_message = next(
        message
        for message in image_response.json()["messages"]
        if message["attachment_url"] == "https://files.example.test/support/image.jpg"
    )
    assert image_message["attachment_url"] == "https://files.example.test/support/image.jpg"

    delete_response = await client.delete(
        f"/api/v1/support/messages/{client_message_id}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert delete_response.status_code == 200
    remaining_message_ids = {message["id"] for message in delete_response.json()["messages"]}
    assert client_message_id not in remaining_message_ids

    delete_image_response = await client.delete(
        f"/api/v1/support/messages/{image_message['id']}",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert delete_image_response.status_code == 200
    remaining_message_ids = {
        message["id"] for message in delete_image_response.json()["messages"]
    }
    assert image_message["id"] not in remaining_message_ids

    async with session_factory() as session:
        assert await session.get(SupportMessage, uuid.UUID(client_message_id)) is None
        assert await session.get(SupportMessage, uuid.UUID(image_message["id"])) is None
