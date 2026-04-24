import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import IntegrationEvent, Channel, Dialogue, Message, Client
from app.integrations.avito.schemas import AvitoWebhookPayload

logger = logging.getLogger(__name__)

class AvitoWebhookService:
    async def process_inbound_webhook(self, session: AsyncSession, payload: AvitoWebhookPayload):
        """
        Обрабатывает входящий вебхук от Авито со строгой проверкой и идемпотентностью.
        """
        # Идемпотентность Уровень 1: Проверка на существование события
        stmt = select(IntegrationEvent).where(
            IntegrationEvent.source == 'avito',
            IntegrationEvent.external_event_id == payload.event_id
        )
        existing_event = (await session.execute(stmt)).scalars().first()
        if existing_event:
            logger.info(f"Duplicate integration event detected: {payload.event_id}")
            return

        # Гарантированное сохранение сырого лога
        event = IntegrationEvent(
            source='avito',
            external_event_id=payload.event_id,
            payload=payload.model_dump(),
            status='received'
        )
        session.add(event)
        await session.commit()
        await session.refresh(event)

        try:
            # Поиск или создание Канала
            stmt = select(Channel).where(
                Channel.name == 'avito',
                Channel.external_account_id == payload.account_id
            )
            channel = (await session.execute(stmt)).scalars().first()
            if not channel:
                channel = Channel(name='avito', external_account_id=payload.account_id)
                session.add(channel)
                await session.flush()

            # Безопасное создание Клиента
            stmt = select(Client).where(
                Client.external_source == 'avito',
                Client.external_user_id == payload.payload.user_id
            )
            client = (await session.execute(stmt)).scalars().first()
            if not client:
                client = Client(
                    name=f"Avito User {payload.payload.user_id}",
                    phone=None,
                    external_source="avito",
                    external_user_id=payload.payload.user_id
                )
                session.add(client)
                await session.flush()

            # Ищем или создаем диалог
            stmt = select(Dialogue).where(
                Dialogue.channel_id == channel.id,
                Dialogue.external_dialog_id == payload.payload.chat_id
            )
            dialogue = (await session.execute(stmt)).scalars().first()
            if not dialogue:
                dialogue = Dialogue(
                    channel_id=channel.id,
                    external_dialog_id=payload.payload.chat_id,
                    client_id=client.id,
                    status='open',
                    last_message_at=datetime.utcnow()
                )
                session.add(dialogue)
                await session.flush()
            else:
                dialogue.last_message_at = datetime.utcnow()

            # Идемпотентность Уровень 2: Проверка дубля сообщения в рамках диалога
            stmt = select(Message).where(
                Message.external_message_id == payload.payload.message_id,
                Message.dialogue_id == dialogue.id
            )
            existing_message = (await session.execute(stmt)).scalars().first()
            if existing_message:
                logger.info(f"Message {payload.payload.message_id} already exists in dialogue. Marking event as processed.")
                event.status = 'processed'
                await session.commit()
                return

            # Создание сообщения
            new_message = Message(
                dialogue_id=dialogue.id,
                external_message_id=payload.payload.message_id,
                direction='inbound',
                message_type='text',
                text=payload.payload.text,
                raw_payload=payload.model_dump()
            )
            session.add(new_message)

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
