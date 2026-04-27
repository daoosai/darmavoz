import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.future import select

from app.core.config import settings
from app.integrations.avito.service import AvitoWebhookService
from app.models.models import Dialogue, IntegrationEvent, Message

pytestmark = pytest.mark.asyncio
WEBHOOK_URL = "/api/v1/webhooks/avito"


@pytest.fixture(autouse=True)
def default_webhook_auth(monkeypatch):
    monkeypatch.setattr(settings, "AVITO_WEBHOOK_URL_TOKEN", "test-token")
    monkeypatch.setattr(settings, "AVITO_WEBHOOK_ALLOWED_IPS", "")


def build_headers(secret: str | None = None) -> dict[str, str]:
    if secret is None:
        return {}
    return {settings.AVITO_WEBHOOK_HEADER_NAME: secret}


def build_query(token: str | None = None) -> str:
    if not token:
        return ""
    return f"?token={token}"


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
            "sender_user_id": user_id,
            "message_id": message_id,
            "text": text_value,
            "direction": "inbound",
            "message_type": "text",
        },
    }


def build_real_avito_payload(
    *,
    event_id: str,
    account_id: str = "acc_1",
    chat_id: str = "chat_1",
    author_id: str = "user_1",
    message_id: str = "msg_1",
    text_value: str = "Hello",
    direction: str = "in",
) -> dict:
    return {
        "id": event_id,
        "payload": {
            "type": "message",
            "value": {
                "id": message_id,
                "chat_id": chat_id,
                "user_id": account_id,
                "author_id": author_id,
                "content": {"text": text_value},
                "type": "text",
                "direction": direction,
            },
        },
    }


async def test_invalid_body(client: AsyncClient):
    response = await client.post(f"{WEBHOOK_URL}?token=test-token", json={"invalid": "data"})
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


async def test_valid_webhook_token(client: AsyncClient, monkeypatch):
    response = await client.post(
        f"{WEBHOOK_URL}{build_query('test-token')}",
        json=build_payload(event_id="test_event_token_ok"),
    )
    assert response.status_code == 200


async def test_valid_ip_allowlist(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "AVITO_WEBHOOK_URL_TOKEN", None)
    monkeypatch.setattr(settings, "AVITO_WEBHOOK_ALLOWED_IPS", "203.0.113.10")
    response = await client.post(
        WEBHOOK_URL,
        json=build_payload(event_id="test_event_ip_ok"),
        headers={"X-Forwarded-For": "198.51.100.20, 203.0.113.10"},
    )
    assert response.status_code == 200


async def test_happy_path(client: AsyncClient, session_factory):
    payload = build_payload(event_id="test_event_happy", message_id="msg_happy")
    response = await client.post(f"{WEBHOOK_URL}?token=test-token", json=payload)
    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "processed"}

    async with session_factory() as db_session:
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_event_happy")
        event = (await db_session.execute(stmt)).scalars().first()
    assert event is not None
    assert event.status == "processed"


async def test_duplicate_event(client: AsyncClient, session_factory):
    payload = build_payload(event_id="test_event_duplicate", message_id="msg_duplicate")
    response1 = await client.post(f"{WEBHOOK_URL}?token=test-token", json=payload)
    assert response1.status_code == 200

    response2 = await client.post(f"{WEBHOOK_URL}?token=test-token", json=payload)
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

    response1 = await client.post(f"{WEBHOOK_URL}?token=test-token", json=first_payload)
    response2 = await client.post(f"{WEBHOOK_URL}?token=test-token", json=second_payload)

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

    response1 = await client.post(f"{WEBHOOK_URL}?token=test-token", json=first_payload)
    response2 = await client.post(f"{WEBHOOK_URL}?token=test-token", json=second_payload)

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
        f"{WEBHOOK_URL}?token=test-token",
        json=build_payload(event_id="test_event_error", message_id="msg_error"),
    )
    assert response.status_code == 500

    async with session_factory() as db_session:
        stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == "test_event_error")
        event = (await db_session.execute(stmt)).scalars().first()
    assert event is not None
    assert event.status == "failed"
    assert "Database error on channel" in event.error_message


async def test_real_avito_payload_happy_path(client: AsyncClient, session_factory):
    payload = build_real_avito_payload(
        event_id="real_event_happy",
        account_id="acc_real",
        chat_id="chat_real",
        author_id="client_real",
        message_id="msg_real",
        text_value="Real hello",
    )
    response = await client.post(f"{WEBHOOK_URL}?token=test-token", json=payload)
    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "processed"}

    async with session_factory() as db_session:
        event = (
            await db_session.execute(
                select(IntegrationEvent).where(IntegrationEvent.external_event_id == "real_event_happy")
            )
        ).scalars().first()
        dialogue = (
            await db_session.execute(
                select(Dialogue).where(Dialogue.external_dialog_id == "chat_real")
            )
        ).scalars().first()
        messages = (
            await db_session.execute(
                select(Message).where(Message.external_message_id == "msg_real")
            )
        ).scalars().all()

    assert event is not None
    assert event.status == "processed"
    assert dialogue is not None
    assert len(messages) == 1
    assert messages[0].text == "Real hello"
    assert messages[0].direction == "inbound"


async def test_real_avito_payload_outbound_ignored(client: AsyncClient, session_factory):
    payload = build_real_avito_payload(
        event_id="real_event_outbound",
        account_id="acc_real",
        chat_id="chat_real_out",
        author_id="acc_real",
        message_id="msg_real_out",
        text_value="Outbound hello",
        direction="out",
    )
    response = await client.post(f"{WEBHOOK_URL}?token=test-token", json=payload)
    assert response.status_code == 200

    async with session_factory() as db_session:
        event = (
            await db_session.execute(
                select(IntegrationEvent).where(IntegrationEvent.external_event_id == "real_event_outbound")
            )
        ).scalars().first()
        messages = (
            await db_session.execute(
                select(Message).where(Message.external_message_id == "msg_real_out")
            )
        ).scalars().all()

    assert event is not None
    assert event.status == "processed"
    assert len(messages) == 0


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
