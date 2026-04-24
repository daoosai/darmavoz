import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.future import select

from app.core.config import settings
from app.integrations.avito.service import AvitoWebhookService
from app.models.models import Dialogue, IntegrationEvent, Message

pytestmark = pytest.mark.asyncio
WEBHOOK_URL = "/api/v1/webhooks/avito"


def build_headers(secret: str | None = None) -> dict[str, str]:
    return {
        settings.AVITO_WEBHOOK_HEADER_NAME: (
            settings.AVITO_WEBHOOK_SECRET if secret is None else secret
        )
    }


def build_payload(
    *,
    event_id: str,
    account_id: str = "acc_1",
    chat_id: str = "chat_1",
    user_id: str = "user_1",
    message_id: str = "msg_1",
    text_value: str = "Hello",
) -> dict:
    return {
        "event_id": event_id,
        "account_id": account_id,
        "payload": {
            "chat_id": chat_id,
            "user_id": user_id,
            "message_id": message_id,
            "text": text_value,
        },
    }


async def test_invalid_body(client: AsyncClient):
    response = await client.post(WEBHOOK_URL, json={"invalid": "data"}, headers=build_headers())
    assert response.status_code == 422


async def test_no_secret(client: AsyncClient):
    response = await client.post(WEBHOOK_URL, json=build_payload(event_id="test_event_no_secret"))
    assert response.status_code == 403


async def test_wrong_webhook_secret(client: AsyncClient):
    response = await client.post(
        WEBHOOK_URL,
        json=build_payload(event_id="test_event_wrong_secret"),
        headers=build_headers("wrong-secret"),
    )
    assert response.status_code == 403


async def test_happy_path(client: AsyncClient, session_factory):
    payload = build_payload(event_id="test_event_happy", message_id="msg_happy")
    response = await client.post(WEBHOOK_URL, json=payload, headers=build_headers())
    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "processed"}

    async with session_factory() as db_session:
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_event_happy")
        event = (await db_session.execute(stmt)).scalars().first()
    assert event is not None
    assert event.status == "processed"


async def test_duplicate_event(client: AsyncClient, session_factory):
    payload = build_payload(event_id="test_event_duplicate", message_id="msg_duplicate")
    response1 = await client.post(WEBHOOK_URL, json=payload, headers=build_headers())
    assert response1.status_code == 200

    response2 = await client.post(WEBHOOK_URL, json=payload, headers=build_headers())
    assert response2.status_code == 200

    async with session_factory() as db_session:
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_event_duplicate")
        events = (await db_session.execute(stmt)).scalars().all()
    assert len(events) == 1


async def test_duplicate_message_same_dialogue(client: AsyncClient, session_factory):
    first_payload = build_payload(
        event_id="test_event_duplicate_message_same_dialogue_1",
        chat_id="chat_same",
        message_id="shared_message_id",
    )
    second_payload = build_payload(
        event_id="test_event_duplicate_message_same_dialogue_2",
        chat_id="chat_same",
        message_id="shared_message_id",
        text_value="Hello again",
    )

    response1 = await client.post(WEBHOOK_URL, json=first_payload, headers=build_headers())
    response2 = await client.post(WEBHOOK_URL, json=second_payload, headers=build_headers())

    assert response1.status_code == 200
    assert response2.status_code == 200

    async with session_factory() as db_session:
        dialogue = (
            await db_session.execute(
                select(Dialogue).where(Dialogue.external_dialog_id == "chat_same")
            )
        ).scalar_one()
        messages = (
            await db_session.execute(
                select(Message).where(
                    Message.dialogue_id == dialogue.id,
                    Message.external_message_id == "shared_message_id",
                )
            )
        ).scalars().all()
        events = (
            await db_session.execute(
                select(IntegrationEvent).where(
                    IntegrationEvent.external_event_id.in_(
                        [
                            "test_event_duplicate_message_same_dialogue_1",
                            "test_event_duplicate_message_same_dialogue_2",
                        ]
                    )
                )
            )
        ).scalars().all()

    assert len(messages) == 1
    assert len(events) == 2


async def test_duplicate_message_different_dialogue(client: AsyncClient, session_factory):
    first_payload = build_payload(
        event_id="test_event_duplicate_message_different_dialogue_1",
        chat_id="chat_a",
        message_id="cross_dialog_message_id",
    )
    second_payload = build_payload(
        event_id="test_event_duplicate_message_different_dialogue_2",
        chat_id="chat_b",
        message_id="cross_dialog_message_id",
    )

    response1 = await client.post(WEBHOOK_URL, json=first_payload, headers=build_headers())
    response2 = await client.post(WEBHOOK_URL, json=second_payload, headers=build_headers())

    assert response1.status_code == 200
    assert response2.status_code == 200

    async with session_factory() as db_session:
        messages = (
            await db_session.execute(
                select(Message).where(Message.external_message_id == "cross_dialog_message_id")
            )
        ).scalars().all()

    assert len(messages) == 2


async def test_internal_error(client: AsyncClient, session_factory, monkeypatch):
    async def mock_get_or_create_channel(self, session, account_id):
        raise RuntimeError("Database error on channel")

    monkeypatch.setattr(AvitoWebhookService, "_get_or_create_channel", mock_get_or_create_channel)

    response = await client.post(
        WEBHOOK_URL,
        json=build_payload(event_id="test_event_error", message_id="msg_error"),
        headers=build_headers(),
    )
    assert response.status_code == 500

    async with session_factory() as db_session:
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_event_error")
        event = (await db_session.execute(stmt)).scalars().first()
    assert event is not None
    assert event.status == "failed"
    assert "Database error on channel" in event.error_message


async def test_migrations_smoke(session_factory):
    required_tables = {
        "roles",
        "users",
        "clients",
        "drivers",
        "orders",
        "events",
        "order_offers",
        "integration_events",
        "channels",
        "dialogues",
        "messages",
        "alembic_version",
    }

    async with session_factory() as db_session:
        table_rows = (
            await db_session.execute(
                text(
                    "SELECT table_name "
                    "FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )
            )
        ).scalars().all()
        phone_nullable = (
            await db_session.execute(
                text(
                    "SELECT is_nullable "
                    "FROM information_schema.columns "
                    "WHERE table_schema = 'public' "
                    "AND table_name = 'clients' "
                    "AND column_name = 'phone'"
                )
            )
        ).scalar_one()

    assert required_tables.issubset(set(table_rows))
    assert phone_nullable == "YES"
