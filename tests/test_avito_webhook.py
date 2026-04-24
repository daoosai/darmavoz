import pytest
from httpx import AsyncClient
from sqlalchemy.future import select
from app.models.models import IntegrationEvent
from app.core.config import settings

# Маркер для запуска асинхронных тестов
pytestmark = pytest.mark.asyncio

async def test_invalid_body(client: AsyncClient):
    """Ожидаем 422 Unprocessable Entity при отправке неверного тела."""
    headers = {"x-webhook-secret": settings.AVITO_WEBHOOK_SECRET}
    response = await client.post("/api/v1/webhooks/avito", json={"invalid": "data"}, headers=headers)
    assert response.status_code == 422

async def test_no_secret(client: AsyncClient):
    """Ожидаем 403 Forbidden при отсутствии или неверном секрете."""
    response = await client.post("/api/v1/webhooks/avito", json={
        "event_id": "test_event_1",
        "account_id": "acc_1",
        "payload": {
            "chat_id": "chat_1",
            "user_id": "user_1",
            "message_id": "msg_1",
            "text": "Hello"
        }
    })
    assert response.status_code == 403

async def test_happy_path(client: AsyncClient, session_factory):
    """Ожидаем 200 OK и создание записей в БД при валидном вебхуке."""
    headers = {"x-webhook-secret": settings.AVITO_WEBHOOK_SECRET}
    payload = {
        "event_id": "test_event_happy",
        "account_id": "acc_1",
        "payload": {
            "chat_id": "chat_1",
            "user_id": "user_1",
            "message_id": "msg_happy",
            "text": "Hello"
        }
    }
    response = await client.post("/api/v1/webhooks/avito", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "processed"}

    # Проверяем, что событие сохранилось в БД
    async with session_factory() as db_session:
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_event_happy")
        event = (await db_session.execute(stmt)).scalars().first()
    assert event is not None
    assert event.status == "processed"

async def test_duplicate_event(client: AsyncClient, session_factory):
    """Ожидаем 200 OK при дубликате, но в БД не должно появиться новой записи."""
    headers = {"x-webhook-secret": settings.AVITO_WEBHOOK_SECRET}
    payload = {
        "event_id": "test_event_duplicate",
        "account_id": "acc_1",
        "payload": {
            "chat_id": "chat_1",
            "user_id": "user_1",
            "message_id": "msg_duplicate",
            "text": "Hello"
        }
    }
    
    # Первый запрос
    response1 = await client.post("/api/v1/webhooks/avito", json=payload, headers=headers)
    assert response1.status_code == 200

    # Второй запрос (дубль)
    response2 = await client.post("/api/v1/webhooks/avito", json=payload, headers=headers)
    assert response2.status_code == 200

    # Проверяем, что запись только одна
    async with session_factory() as db_session:
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_event_duplicate")
        events = (await db_session.execute(stmt)).scalars().all()
    assert len(events) == 1

async def test_internal_error(client: AsyncClient, session_factory, monkeypatch):
    """Ожидаем 500 Internal Server Error при падении бизнес-логики, статус в БД - failed."""
    headers = {"x-webhook-secret": settings.AVITO_WEBHOOK_SECRET}
    payload = {
        "event_id": "test_event_error",
        "account_id": "acc_1",
        "payload": {
            "chat_id": "chat_1",
            "user_id": "user_1",
            "message_id": "msg_error",
            "text": "Hello"
        }
    }

    # Мокаем execute так, чтобы он падал на Channel (после создания Event)
    from sqlalchemy.ext.asyncio import AsyncSession
    original_execute = AsyncSession.execute
    
    async def mock_execute(self, stmt, *args, **kwargs):
        # Если это insert в Channel, кидаем ошибку
        if "INSERT INTO channels" in str(stmt):
            raise RuntimeError("Database error on channel")
        return await original_execute(self, stmt, *args, **kwargs)

    monkeypatch.setattr("sqlalchemy.ext.asyncio.AsyncSession.execute", mock_execute)

    response = await client.post("/api/v1/webhooks/avito", json=payload, headers=headers)
    assert response.status_code == 500
    monkeypatch.undo()

    # Проверяем, что событие сохранилось в БД со статусом failed
    async with session_factory() as db_session:
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_event_error")
        event = (await db_session.execute(stmt)).scalars().first()
    assert event is not None
    assert event.status == "failed"
    assert "Database error on channel" in event.error_message
