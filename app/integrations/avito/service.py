import logging
from datetime import UTC, datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.dialects.postgresql import insert

from app.models.models import IntegrationEvent, Channel, Dialogue, Message, Client
from app.integrations.avito.schemas import AvitoWebhookPayload

logger = logging.getLogger(__name__)

class AvitoWebhookService:
    async def process_inbound_webhook(self, session: AsyncSession, payload: AvitoWebhookPayload):
        """
        Обрабатывает входящий вебхук от Авито со строгой проверкой и идемпотентностью.
        """
        # Гарантированное сохранение сырого лога + Идемпотентность (ON CONFLICT DO NOTHING)
        stmt = insert(IntegrationEvent).values(
            source='avito',
            external_event_id=payload.event_id,
            payload=payload.model_dump(),
            status='received'
        ).on_conflict_do_nothing(
            constraint='uix_integration_events_source_external_id'
        ).returning(IntegrationEvent.id)
        
        result = await session.execute(stmt)
        event_id = result.scalar_one_or_none()
        
        if not event_id:
            logger.info(f"Duplicate integration event detected: {payload.event_id}")
            return
            
        await session.commit()
        
        # Получаем созданный event для обновления статуса
        event = await session.get(IntegrationEvent, event_id)

        try:
            # Поиск или создание Канала
            stmt_channel = insert(Channel).values(
                name='avito',
                external_account_id=payload.account_id
            ).on_conflict_do_nothing(
                constraint='uix_channels_name_external_id'
            ).returning(Channel.id)
            
            result = await session.execute(stmt_channel)
            channel_id = result.scalar_one_or_none()
            if not channel_id:
                stmt_select_channel = select(Channel.id).where(
                    Channel.name == 'avito',
                    Channel.external_account_id == payload.account_id
                )
                channel_id = (await session.execute(stmt_select_channel)).scalar_one()

            # Безопасное создание Клиента
            stmt_client = insert(Client).values(
                name=f"Avito User {payload.payload.user_id}",
                phone=None,
                external_source="avito",
                external_user_id=payload.payload.user_id
            ).on_conflict_do_nothing(
                constraint='uq_client_ext_source_id'
            ).returning(Client.id)
            
            result = await session.execute(stmt_client)
            client_id = result.scalar_one_or_none()
            if not client_id:
                stmt_select_client = select(Client.id).where(
                    Client.external_source == 'avito',
                    Client.external_user_id == payload.payload.user_id
                )
                client_id = (await session.execute(stmt_select_client)).scalar_one()

            # Ищем или создаем диалог
            stmt_dialogue = insert(Dialogue).values(
                channel_id=channel_id,
                external_dialog_id=payload.payload.chat_id,
                client_id=client_id,
                status='open',
                last_message_at=datetime.now(UTC)
            ).on_conflict_do_nothing(
                constraint='uix_dialogues_channel_external_id'
            ).returning(Dialogue.id)
            
            result = await session.execute(stmt_dialogue)
            dialogue_id = result.scalar_one_or_none()
            if not dialogue_id:
                stmt_select_dialogue = select(Dialogue).where(
                    Dialogue.channel_id == channel_id,
                    Dialogue.external_dialog_id == payload.payload.chat_id
                )
                dialogue = (await session.execute(stmt_select_dialogue)).scalars().first()
                dialogue.last_message_at = datetime.now(UTC)
                dialogue_id = dialogue.id

            # Идемпотентность Уровень 2: Создание сообщения (ON CONFLICT DO NOTHING)
            stmt_message = insert(Message).values(
                dialogue_id=dialogue_id,
                external_message_id=payload.payload.message_id,
                direction='inbound',
                message_type='text',
                text=payload.payload.text,
                raw_payload=payload.model_dump()
            ).on_conflict_do_nothing(
                constraint='uix_messages_dialogue_external_id'
            ).returning(Message.id)
            
            result = await session.execute(stmt_message)
            message_id = result.scalar_one_or_none()
            
            if not message_id:
                logger.info(f"Message {payload.payload.message_id} already exists in dialogue. Marking event as processed.")
            
            event.status = 'processed'
            await session.commit()
            logger.info(f"Successfully processed Avito webhook event: {payload.event_id}")

        except Exception as e:
            logger.error(f"Error processing Avito webhook: {str(e)}", exc_info=True)
            await session.rollback()
            
            event.status = 'failed'
            event.error_message = str(e)
            session.add(event)
            await session.commit()
            raise e
