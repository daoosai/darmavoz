import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.integrations.openai.client import OpenAIClient
from app.models.models import Channel, Client, Dialogue, Message, MessageAiAnalysis, Order
from app.schemas.ai import MessageAnalysisResult, MessageClassificationEnum, OrderExtractedFields
from app.services.message_ai_processor import MessageAIProcessorService

pytestmark = pytest.mark.asyncio


async def create_dialogue_message(
    session,
    *,
    client_name: str = "Avito User placeholder",
    client_phone: str | None = None,
    message_text: str = "Нужен песок, 10 кубов",
) -> tuple[Client, Dialogue, Message]:
    client = Client(
        name=client_name,
        phone=client_phone,
        external_source="avito",
        external_user_id=f"user_{uuid.uuid4().hex[:8]}",
    )
    channel = Channel(
        name="avito",
        external_account_id=f"account_{uuid.uuid4().hex[:8]}",
    )
    session.add_all([client, channel])
    await session.flush()

    dialogue = Dialogue(
        channel_id=channel.id,
        external_dialog_id=f"dialogue_{uuid.uuid4().hex[:8]}",
        client_id=client.id,
        status="open",
    )
    session.add(dialogue)
    await session.flush()

    message = Message(
        dialogue_id=dialogue.id,
        external_message_id=f"message_{uuid.uuid4().hex[:8]}",
        direction="inbound",
        message_type="text",
        text=message_text,
    )
    session.add(message)
    await session.commit()
    return client, dialogue, message


def build_analysis_result(
    *,
    classification: MessageClassificationEnum,
    should_create_order_draft: bool,
    is_order_related: bool = True,
    client_message_summary: str = "Краткая сводка клиента.",
    missing_fields: list[str] | None = None,
    needs_clarification: bool = False,
    confidence: float = 0.95,
    material: str | None = None,
    volume: float | None = None,
    address: str | None = None,
    datetime_str: str | None = None,
    client_name: str | None = None,
    client_phone: str | None = None,
    notes: str | None = None,
) -> MessageAnalysisResult:
    return MessageAnalysisResult(
        classification=classification,
        is_order_related=is_order_related,
        client_message_summary=client_message_summary,
        order_fields=OrderExtractedFields(
            material=material,
            volume=volume,
            address=address,
            datetime_str=datetime_str,
            client_name=client_name,
            client_phone=client_phone,
            notes=notes,
        ),
        missing_fields=missing_fields or [],
        needs_clarification=needs_clarification,
        should_create_order_draft=should_create_order_draft,
        confidence=confidence,
    )


async def fetch_analysis(session, message_id):
    return (
        await session.execute(
            select(MessageAiAnalysis).where(MessageAiAnalysis.message_id == message_id)
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_openai_client_uses_llm_base_url(monkeypatch):
    monkeypatch.setattr(settings, "LLM_API_KEY", "proxy-key")
    monkeypatch.setattr(settings, "LLM_BASE_URL", "https://api.proxyapi.ru/openai/v1")
    monkeypatch.setattr(settings, "LLM_MAX_RETRIES", 7)
    monkeypatch.setattr(settings, "LLM_TIMEOUT_SECONDS", 45)

    with patch("app.integrations.openai.client.AsyncOpenAI") as mock_async_openai:
        client = OpenAIClient()

    mock_async_openai.assert_called_once_with(
        api_key="proxy-key",
        base_url="https://api.proxyapi.ru/openai/v1",
        max_retries=7,
        timeout=45,
    )
    assert client.client is mock_async_openai.return_value


async def test_process_new_message_creates_draft(session_factory):
    async with session_factory() as session:
        _, dialogue, message = await create_dialogue_message(session)
        analysis_result = build_analysis_result(
            classification=MessageClassificationEnum.new_order,
            should_create_order_draft=True,
            client_message_summary="Клиент просит песок 10 кубов.",
            missing_fields=["address"],
            needs_clarification=True,
            material="Песок",
            volume=10.0,
        )

        with patch.object(OpenAIClient, "analyze_message", new=AsyncMock(return_value=analysis_result)):
            service = MessageAIProcessorService()
            await service.process_new_message(session, message.id)

    async with session_factory() as session:
        db_analysis = await fetch_analysis(session, message.id)
        db_dialogue = await session.get(Dialogue, dialogue.id)
        db_order = await session.get(Order, db_dialogue.order_id)

    assert db_analysis.status == "processed"
    assert db_analysis.classification == MessageClassificationEnum.new_order.value
    assert db_order is not None
    assert db_order.status == "draft"
    assert db_order.material == "Песок"
    assert db_order.volume == 10.0
    assert db_order.notes == "Summary: Клиент просит песок 10 кубов."
    assert db_dialogue.order_id == db_order.id


async def test_order_update_updates_existing_draft(session_factory):
    async with session_factory() as session:
        client, dialogue, message = await create_dialogue_message(session)
        existing_order = Order(
            client_id=client.id,
            status="draft",
            material="Щебень",
            volume=5.0,
            source_dialogue_id=dialogue.id,
        )
        session.add(existing_order)
        await session.flush()
        dialogue.order_id = existing_order.id
        await session.commit()

        analysis_result = build_analysis_result(
            classification=MessageClassificationEnum.order_update,
            should_create_order_draft=True,
            client_message_summary="Клиент уточнил заказ.",
            material="Песок",
            volume=12.0,
            address="ул. Ленина, 1",
            datetime_str="завтра 10:00",
            client_name="Иван",
            client_phone="+79990001122",
            notes="Позвонить за час",
        )

        with patch.object(OpenAIClient, "analyze_message", new=AsyncMock(return_value=analysis_result)):
            service = MessageAIProcessorService()
            await service.process_new_message(session, message.id)

    async with session_factory() as session:
        db_client = await session.get(Client, client.id)
        db_dialogue = await session.get(Dialogue, dialogue.id)
        db_order = await session.get(Order, existing_order.id)
        db_analysis = await fetch_analysis(session, message.id)

    assert db_analysis.status == "processed"
    assert db_order.id == existing_order.id
    assert db_order.material == "Песок"
    assert db_order.volume == 12.0
    assert db_order.address == "ул. Ленина, 1"
    assert db_order.notes == "Summary: Клиент уточнил заказ. | Date: завтра 10:00 | Notes: Позвонить за час"
    assert db_client.name == "Иван"
    assert db_client.phone == "+79990001122"
    assert db_dialogue.order_id == existing_order.id


async def test_question_does_not_create_draft(session_factory):
    async with session_factory() as session:
        client, dialogue, message = await create_dialogue_message(session, message_text="Сколько стоит доставка?")
        analysis_result = build_analysis_result(
            classification=MessageClassificationEnum.question,
            should_create_order_draft=False,
            is_order_related=False,
            client_message_summary="Клиент задает вопрос по стоимости.",
        )

        with patch.object(OpenAIClient, "analyze_message", new=AsyncMock(return_value=analysis_result)):
            service = MessageAIProcessorService()
            await service.process_new_message(session, message.id)

    async with session_factory() as session:
        db_analysis = await fetch_analysis(session, message.id)
        db_dialogue = await session.get(Dialogue, dialogue.id)
        db_orders = (
            await session.execute(select(Order).where(Order.client_id == client.id))
        ).scalars().all()

    assert db_analysis.status == "processed"
    assert db_analysis.classification == MessageClassificationEnum.question.value
    assert db_dialogue.order_id is None
    assert db_orders == []


async def test_irrelevant_does_not_create_draft(session_factory):
    async with session_factory() as session:
        client, dialogue, message = await create_dialogue_message(session, message_text="Спасибо!")
        analysis_result = build_analysis_result(
            classification=MessageClassificationEnum.irrelevant,
            should_create_order_draft=False,
            is_order_related=False,
            client_message_summary="Нерелевантное сообщение.",
        )

        with patch.object(OpenAIClient, "analyze_message", new=AsyncMock(return_value=analysis_result)):
            service = MessageAIProcessorService()
            await service.process_new_message(session, message.id)

    async with session_factory() as session:
        db_analysis = await fetch_analysis(session, message.id)
        db_dialogue = await session.get(Dialogue, dialogue.id)
        db_orders = (
            await session.execute(select(Order).where(Order.client_id == client.id))
        ).scalars().all()

    assert db_analysis.status == "processed"
    assert db_analysis.classification == MessageClassificationEnum.irrelevant.value
    assert db_dialogue.order_id is None
    assert db_orders == []


async def test_failed_llm_persists_failed_status(session_factory):
    async with session_factory() as session:
        _, _, message = await create_dialogue_message(session)
        message_id = message.id

        with patch.object(
            OpenAIClient,
            "analyze_message",
            new=AsyncMock(side_effect=RuntimeError("OpenAI API unavailable")),
        ):
            service = MessageAIProcessorService()
            await service.process_new_message(session, message_id)

    async with session_factory() as session:
        db_analysis = await fetch_analysis(session, message_id)

    assert db_analysis.status == "failed"
    assert db_analysis.classification is None
    assert db_analysis.error_message == "OpenAI API unavailable"


async def test_non_draft_protection(session_factory):
    async with session_factory() as session:
        client, dialogue, message = await create_dialogue_message(session)
        protected_order = Order(
            client_id=client.id,
            status="in_progress",
            material="Щебень",
            volume=7.0,
            address="Старый адрес",
            notes="Старые заметки",
            source_dialogue_id=dialogue.id,
        )
        session.add(protected_order)
        await session.flush()
        dialogue.order_id = protected_order.id
        await session.commit()

        analysis_result = build_analysis_result(
            classification=MessageClassificationEnum.order_update,
            should_create_order_draft=True,
            client_message_summary="Клиент пытается изменить активный заказ.",
            material="Песок",
            volume=20.0,
            address="Новый адрес",
            datetime_str="сегодня",
            notes="Новые заметки",
        )

        with patch.object(OpenAIClient, "analyze_message", new=AsyncMock(return_value=analysis_result)):
            service = MessageAIProcessorService()
            await service.process_new_message(session, message.id)

    async with session_factory() as session:
        db_analysis = await fetch_analysis(session, message.id)
        db_order = await session.get(Order, protected_order.id)

    assert db_analysis.status == "needs_review"
    assert db_analysis.error_message == "Cannot update non-draft order"
    assert db_order.material == "Щебень"
    assert db_order.volume == 7.0
    assert db_order.address == "Старый адрес"
    assert db_order.notes == "Старые заметки"
