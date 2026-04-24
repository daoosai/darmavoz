import hashlib
import json
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
import logging

from app.models.models import IntegrationEvent, Channel, Dialogue, Message, Client

logger = logging.getLogger(__name__)

class AvitoWebhookService:
    async def process_inbound_webhook(self, session: AsyncSession, raw_payload: dict):
        """
        Обрабатывает входящий вебхук от Авито с идемпотентным сохранением.
        """
        # Генерируем уникальный ID события, если его нет в явном виде
        # Часто Авито передает ID события, но для подстраховки можно использовать хэш
        payload_str = json.dumps(raw_payload, sort_keys=True)
        external_event_id = raw_payload.get('event_id') or hashlib.md5(payload_str.encode()).hexdigest()

        # 1. Сохранение сырого события
        integration_event = IntegrationEvent(
            source='avito',
            external_event_id=external_event_id,
            payload=raw_payload,
            status='received'
        )
        
        try:
            session.add(integration_event)
            await session.flush() # Получаем ID для integration_event, но не коммитим
        except IntegrityError:
            # Событие с таким source + external_event_id уже существует
            await session.rollback()
            logger.info(f"Duplicate integration event detected: {external_event_id}")
            return # Прерываем, так как это дубликат

        try:
            # 2. Парсинг данных
            # Безопасное извлечение данных из сложной структуры (зависит от реальной структуры Авито)
            payload_data = raw_payload.get('payload', {})
            value_data = payload_data.get('value', {})
            
            # Извлекаем нужные поля (примерные названия полей)
            chat_id = value_data.get('chat_id') or raw_payload.get('chat_id')
            user_id = value_data.get('user_id') or raw_payload.get('user_id')
            msg_text = value_data.get('msg_text') or value_data.get('text') or raw_payload.get('text')
            external_message_id = value_data.get('id') or raw_payload.get('id') or external_event_id # Если нет явного ID сообщения
            
            # Если это не сообщение или не хватает данных, просто помечаем как обработанное и выходим
            if not chat_id or not external_message_id:
                integration_event.status = 'processed'
                integration_event.error_message = "Skipped: Not a message event or missing required fields"
                await session.commit()
                return

            # 3. Идемпотентность (защита от дублей сообщений)
            stmt = select(Message).where(Message.external_message_id == str(external_message_id))
            result = await session.execute(stmt)
            existing_message = result.scalars().first()
            
            if existing_message:
                logger.info(f"Message {external_message_id} already exists. Marking event as processed.")
                integration_event.status = 'processed'
                await session.commit()
                return

            # 4. Создание/Поиск сущностей
            
            # Ищем или создаем канал Авито
            stmt = select(Channel).where(Channel.name == 'avito')
            result = await session.execute(stmt)
            channel = result.scalars().first()
            
            if not channel:
                # В идеале external_account_id должен браться из настроек или вебхука
                account_id = raw_payload.get('account_id', 'default_avito_account')
                channel = Channel(name='avito', external_account_id=str(account_id))
                session.add(channel)
                await session.flush()

            # Ищем или создаем клиента (используем user_id из Авито как телефон/идентификатор для примера)
            client = None
            if user_id:
                # Ищем клиента по суррогатному признаку (например, сохраняем ID Авито в phone или отдельном поле)
                # В текущей модели нет поля external_id для клиента, поэтому пока используем phone
                # В будущем лучше добавить поле avito_user_id в модель Client
                phone_mock = f"avito_{user_id}"
                stmt = select(Client).where(Client.phone == phone_mock)
                result = await session.execute(stmt)
                client = result.scalars().first()
                
                if not client:
                    client = Client(
                        name=value_data.get('user_name', f"Avito User {user_id}"),
                        phone=phone_mock
                    )
                    session.add(client)
                    await session.flush()

            # Ищем или создаем диалог
            stmt = select(Dialogue).where(
                Dialogue.channel_id == channel.id,
                Dialogue.external_dialog_id == str(chat_id)
            )
            result = await session.execute(stmt)
            dialogue = result.scalars().first()
            
            if not dialogue:
                dialogue = Dialogue(
                    channel_id=channel.id,
                    external_dialog_id=str(chat_id),
                    client_id=client.id if client else None,
                    status='open',
                    last_message_at=datetime.utcnow()
                )
                session.add(dialogue)
            else:
                dialogue.last_message_at = datetime.utcnow()
                
            await session.flush()

            # Создаем сообщение
            new_message = Message(
                dialogue_id=dialogue.id,
                external_message_id=str(external_message_id),
                direction='inbound',
                message_type='text', # Можно определять тип динамически
                text=msg_text,
                raw_payload=raw_payload
            )
            session.add(new_message)

            # 5. Финализация
            integration_event.status = 'processed'
            await session.commit()
            logger.info(f"Successfully processed Avito webhook event: {external_event_id}")

        except Exception as e:
            # 6. Обработка ошибок
            logger.error(f"Error processing Avito webhook: {str(e)}", exc_info=True)
            await session.rollback()
            
            # Пытаемся обновить статус события на failed в новой транзакции
            try:
                # Получаем событие заново, так как предыдущая транзакция была откатана
                stmt = select(IntegrationEvent).where(IntegrationEvent.external_event_id == external_event_id)
                result = await session.execute(stmt)
                failed_event = result.scalars().first()
                
                if failed_event:
                    failed_event.status = 'failed'
                    failed_event.error_message = str(e)
                    await session.commit()
            except Exception as inner_e:
                logger.error(f"Failed to update integration event status: {str(inner_e)}")
                await session.rollback()
            
            # Не выбрасываем ошибку наружу, чтобы вернуть 200 OK
            return
