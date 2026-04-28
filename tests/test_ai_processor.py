import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.integrations.openai.client import OpenAIClient
from app.models.models import Channel, Client, Dialogue, Message, MessageAiAnalysis, Order
from app.schemas.ai import MessageAnalysisResult, MessageClassificationEnum, OrderExtractedFields
from app.services.message_ai_processor import MessageAIProcessorService

pytestmark = pytest.mark.asyncio


async def test_process_new_message_creates_draft(session_factory):
    async with session_factory() as session:
        client = Client(
            name="Test Client",
            phone=None,
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
            text="Нужен песок, 10 кубов",
        )
        session.add(message)
        await session.commit()

        analysis_result = MessageAnalysisResult(
            classification=MessageClassificationEnum.new_order,
            is_order_related=True,
            client_message_summary="Клиент просит песок 10 кубов.",
            order_fields=OrderExtractedFields(
                material="Песок",
                volume=10.0,
            ),
            missing_fields=["address"],
            needs_clarification=True,
            should_create_order_draft=True,
            confidence=0.95,
        )

        with patch.object(
            OpenAIClient,
            "analyze_message",
            new=AsyncMock(return_value=analysis_result),
        ):
            service = MessageAIProcessorService()
            await service.process_new_message(session, message.id)

    async with session_factory() as session:
        db_analysis = (
            await session.execute(
                select(MessageAiAnalysis).where(MessageAiAnalysis.message_id == message.id)
            )
        ).scalar_one()
        db_dialogue = await session.get(Dialogue, dialogue.id)
        db_order = (
            await session.execute(
                select(Order).where(Order.id == db_dialogue.order_id)
            )
        ).scalar_one()

    assert db_analysis.status == "processed"
    assert db_analysis.classification == MessageClassificationEnum.new_order.value
    assert db_order is not None
    assert db_order.status == "draft"
    assert db_order.material == "Песок"
    assert db_order.volume == 10.0
    assert db_dialogue.order_id == db_order.id
