import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import AsyncSessionLocal
from app.integrations.openai.client import OpenAIClient
from app.models.models import (
    Dialogue,
    Message,
    MessageAiAnalysis,
    Order,
    OrderStatus,
)
from app.schemas.ai import MessageAnalysisResult, MessageClassificationEnum

logger = logging.getLogger(__name__)


async def background_process_message(message_id: uuid.UUID) -> None:
    try:
        async with AsyncSessionLocal() as session:
            processor = MessageAIProcessorService()
            await processor.process_new_message(session, message_id)
    except Exception:
        logger.exception(
            "background_message_ai_processing_failed",
            extra={"message_id": str(message_id)},
        )


class MessageAIProcessorService:
    def __init__(self, openai_client: OpenAIClient | None = None) -> None:
        self.openai_client = openai_client or OpenAIClient()

    async def process_new_message(self, session: AsyncSession, message_id: uuid.UUID) -> None:
        message: Message | None = None
        dialogue: Dialogue | None = None

        try:
            message = await self._get_message_with_dialogue(session, message_id)
            if message is None:
                raise ValueError(f"Message {message_id} not found")

            dialogue = message.dialogue
            if dialogue is None:
                raise ValueError(f"Dialogue for message {message_id} not found")

            context = await self._build_dialogue_context(session, dialogue.id)
            analysis_result = await self.openai_client.analyze_message(
                text=message.text or "",
                context=context,
            )

            analysis = self._build_processed_analysis(
                message=message,
                dialogue=dialogue,
                analysis_result=analysis_result,
            )
            session.add(analysis)

            if analysis_result.should_create_order_draft:
                await self._upsert_order_draft(
                    session=session,
                    dialogue=dialogue,
                    analysis_result=analysis_result,
                )

            await session.commit()
            logger.info(
                "message_ai_processed",
                extra={
                    "message_id": str(message.id),
                    "dialogue_id": str(dialogue.id),
                    "classification": analysis_result.classification.value,
                    "should_create_order_draft": analysis_result.should_create_order_draft,
                },
            )
        except Exception as exc:
            logger.exception(
                "message_ai_processing_failed",
                extra={"message_id": str(message_id)},
            )
            await session.rollback()

            if message is not None and dialogue is not None:
                failed_analysis = MessageAiAnalysis(
                    message_id=message.id,
                    dialogue_id=dialogue.id,
                    classification=MessageClassificationEnum.irrelevant.value,
                    raw_llm_response=None,
                    normalized_json=None,
                    confidence=0.0,
                    missing_fields=None,
                    status="failed",
                    error_message=str(exc),
                )
                session.add(failed_analysis)
                try:
                    await session.commit()
                except Exception:
                    await session.rollback()
                    logger.exception(
                        "message_ai_failed_analysis_persist_error",
                        extra={
                            "message_id": str(message.id),
                            "dialogue_id": str(dialogue.id),
                        },
                    )

            raise

    async def _get_message_with_dialogue(
        self,
        session: AsyncSession,
        message_id: uuid.UUID,
    ) -> Message | None:
        stmt = (
            select(Message)
            .options(
                selectinload(Message.dialogue),
            )
            .where(Message.id == message_id)
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    async def _build_dialogue_context(self, session: AsyncSession, dialogue_id: uuid.UUID) -> str:
        stmt = (
            select(Message)
            .where(Message.dialogue_id == dialogue_id)
            .order_by(Message.created_at.desc())
            .limit(5)
        )
        result = await session.execute(stmt)
        messages = list(result.scalars().all())
        messages.reverse()

        if not messages:
            return "Контекст отсутствует."

        context_lines: list[str] = []
        for item in messages:
            author = "client" if item.direction == "inbound" else "manager"
            text = (item.text or "").strip() or "[empty message]"
            context_lines.append(f"{author}: {text}")

        return "\n".join(context_lines)

    def _build_processed_analysis(
        self,
        message: Message,
        dialogue: Dialogue,
        analysis_result: MessageAnalysisResult,
    ) -> MessageAiAnalysis:
        normalized_json = analysis_result.model_dump(mode="json")
        return MessageAiAnalysis(
            message_id=message.id,
            dialogue_id=dialogue.id,
            classification=analysis_result.classification.value,
            raw_llm_response=self.openai_client.last_raw_response or analysis_result.model_dump_json(),
            normalized_json=normalized_json,
            confidence=analysis_result.confidence,
            missing_fields=analysis_result.missing_fields,
            status="processed",
            error_message=None,
        )

    async def _upsert_order_draft(
        self,
        session: AsyncSession,
        dialogue: Dialogue,
        analysis_result: MessageAnalysisResult,
    ) -> Order:
        order: Order | None = None
        if dialogue.order_id is not None:
            order = await session.get(Order, dialogue.order_id)

        if order is None:
            if dialogue.client_id is None:
                raise ValueError(f"Dialogue {dialogue.id} has no client_id for draft order creation")

            order = Order(
                client_id=dialogue.client_id,
                status=OrderStatus.draft.value,
                source_dialogue_id=dialogue.id,
            )
            session.add(order)
            await session.flush()

        extracted = analysis_result.order_fields
        if extracted.material:
            order.material = extracted.material
        if extracted.volume is not None:
            order.volume = extracted.volume
        if extracted.address:
            order.address = extracted.address
        if analysis_result.client_message_summary.strip():
            order.notes = analysis_result.client_message_summary.strip()

        dialogue.order_id = order.id
        session.add(order)
        session.add(dialogue)
        return order
