import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import AsyncSessionLocal
from app.integrations.openai.client import OpenAIClient
from app.models.models import (
    Client,
    Dialogue,
    Message,
    MessageAiAnalysis,
    Order,
    OrderStatus,
    Material,
    OrderItem,
)
from app.schemas.ai import MessageAnalysisResult

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
        resolved_message_id: uuid.UUID | None = None
        resolved_dialogue_id: uuid.UUID | None = None

        try:
            message = await self._get_message_with_dialogue(session, message_id)
            if message is None:
                raise ValueError(f"Message {message_id} not found")
            resolved_message_id = message.id

            dialogue = message.dialogue
            if dialogue is None:
                raise ValueError(f"Dialogue for message {message_id} not found")
            resolved_dialogue_id = dialogue.id

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
                    analysis=analysis,
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
                    "analysis_status": analysis.status,
                },
            )
        except Exception as exc:
            logger.exception(
                "message_ai_processing_failed",
                extra={"message_id": str(message_id)},
            )
            await session.rollback()

            if resolved_message_id is not None and resolved_dialogue_id is not None:
                failed_analysis = MessageAiAnalysis(
                    message_id=resolved_message_id,
                    dialogue_id=resolved_dialogue_id,
                    classification=None,
                    raw_llm_response=self.openai_client.last_raw_response,
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
                            "message_id": str(resolved_message_id),
                            "dialogue_id": str(resolved_dialogue_id),
                        },
                    )
            return

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
        analysis: MessageAiAnalysis,
        analysis_result: MessageAnalysisResult,
    ) -> Order | None:
        order: Order | None = None
        if dialogue.order_id is not None:
            order = await session.get(Order, dialogue.order_id)
            if order is not None and order.status != OrderStatus.draft.value:
                analysis.status = "needs_review"
                analysis.error_message = "Cannot update non-draft order"
                logger.warning(
                    "message_ai_non_draft_order_protection",
                    extra={
                        "dialogue_id": str(dialogue.id),
                        "order_id": str(order.id),
                        "order_status": order.status,
                    },
                )
                session.add(analysis)
                return None

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
        
        if extracted.material and extracted.volume is not None:
            stmt = select(Material).where(Material.name.ilike(f"%{extracted.material}%")).limit(1)
            result = await session.execute(stmt)
            material = result.scalar_one_or_none()
            
            if material:
                # Check if an order item already exists for this material
                stmt_item = select(OrderItem).where(
                    OrderItem.order_id == order.id,
                    OrderItem.material_id == material.id
                )
                item_result = await session.execute(stmt_item)
                order_item = item_result.scalar_one_or_none()
                
                if order_item:
                    order_item.volume = extracted.volume
                    if material.price:
                        order_item.amount = extracted.volume * material.price
                else:
                    new_item = OrderItem(
                        order_id=order.id,
                        material_id=material.id,
                        volume=extracted.volume,
                        price=material.price,
                        amount=(extracted.volume * material.price) if material.price else None
                    )
                    session.add(new_item)
                
                await session.flush()
                
                # Recalculate total_amount
                stmt_total = select(OrderItem).where(OrderItem.order_id == order.id)
                total_result = await session.execute(stmt_total)
                items = total_result.scalars().all()
                order.total_amount = sum((item.amount or 0.0) for item in items)
                
        if extracted.address:
            order.address = extracted.address
        order.notes = self._build_order_notes(analysis_result)

        if dialogue.client_id is not None:
            client = await session.get(Client, dialogue.client_id)
            if client is not None:
                self._update_client_from_extracted_fields(client, extracted)
                session.add(client)

        dialogue.order_id = order.id
        session.add(order)
        session.add(dialogue)
        return order

    @staticmethod
    def _build_order_notes(analysis_result: MessageAnalysisResult) -> str | None:
        parts: list[str] = []
        summary = analysis_result.client_message_summary.strip()
        extracted = analysis_result.order_fields

        if summary:
            parts.append(f"Summary: {summary}")
        if extracted.datetime_str:
            parts.append(f"Date: {extracted.datetime_str.strip()}")
        if extracted.notes:
            parts.append(f"Notes: {extracted.notes.strip()}")

        return " | ".join(parts) if parts else None

    @staticmethod
    def _update_client_from_extracted_fields(client: Client, extracted_fields) -> None:
        if extracted_fields.client_name:
            normalized_name = extracted_fields.client_name.strip()
            if normalized_name and (
                not client.name
                or not client.name.strip()
                or client.name.startswith("Avito User")
            ):
                client.name = normalized_name

        if extracted_fields.client_phone:
            normalized_phone = extracted_fields.client_phone.strip()
            if normalized_phone and (not client.phone or not client.phone.strip()):
                client.phone = normalized_phone
