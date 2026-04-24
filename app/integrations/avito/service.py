import logging
from datetime import datetime, timezone
from typing import Tuple

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.integrations.avito.schemas import AvitoWebhookPayload
from app.models.models import Channel, Client, Dialogue, IntegrationEvent, Message

logger = logging.getLogger(__name__)


class AvitoWebhookService:
    SOURCE = "avito"

    async def process_inbound_webhook(self, session: AsyncSession, payload: AvitoWebhookPayload) -> None:
        """
        Обрабатывает входящий вебхук от Авито со строгой проверкой и идемпотентностью.
        """
        raw_payload = payload.model_dump()
        logger.info(
            "event_received",
            extra={
                "source": self.SOURCE,
                "external_event_id": payload.event_id,
                "account_id": payload.account_id,
                "chat_id": payload.payload.chat_id,
                "external_message_id": payload.payload.message_id,
            },
        )

        event_insert_stmt = (
            insert(IntegrationEvent)
            .values(
                source=self.SOURCE,
                external_event_id=payload.event_id,
                payload=raw_payload,
                status="received",
            )
            .on_conflict_do_nothing(constraint="uix_integration_events_source_external_id")
            .returning(IntegrationEvent.id)
        )

        event_result = await session.execute(event_insert_stmt)
        event_id = event_result.scalar_one_or_none()

        if not event_id:
            await session.rollback()
            logger.info(
                "duplicate_event",
                extra={
                    "source": self.SOURCE,
                    "external_event_id": payload.event_id,
                    "account_id": payload.account_id,
                },
            )
            return

        await session.commit()
        event = await session.get(IntegrationEvent, event_id)

        try:
            channel, _ = await self._get_or_create_channel(session, payload.account_id)
            client, _ = await self._get_or_create_client(session, payload.payload.user_id)
            dialogue, _ = await self._get_or_create_dialogue(
                session=session,
                channel=channel,
                client=client,
                external_dialog_id=payload.payload.chat_id,
            )
            message_created = await self._create_message_if_not_exists(
                session=session,
                dialogue=dialogue,
                payload=payload,
                raw_payload=raw_payload,
            )

            event.status = "processed"
            event.error_message = None
            session.add(event)
            await session.commit()
            logger.info(
                "event_processed",
                extra={
                    "source": self.SOURCE,
                    "external_event_id": payload.event_id,
                    "account_id": payload.account_id,
                    "chat_id": payload.payload.chat_id,
                    "external_message_id": payload.payload.message_id,
                    "message_created": message_created,
                },
            )
        except Exception as exc:
            logger.exception(
                "event_processing_failed",
                extra={
                    "source": self.SOURCE,
                    "external_event_id": payload.event_id,
                    "account_id": payload.account_id,
                    "chat_id": payload.payload.chat_id,
                    "external_message_id": payload.payload.message_id,
                },
            )
            await session.rollback()

            failed_event = await session.get(IntegrationEvent, event_id)
            if failed_event is not None:
                failed_event.status = "failed"
                failed_event.error_message = str(exc)
                session.add(failed_event)
                await session.commit()

            raise

    async def _get_or_create_channel(
        self,
        session: AsyncSession,
        account_id: str,
    ) -> Tuple[Channel, bool]:
        stmt = (
            insert(Channel)
            .values(name=self.SOURCE, external_account_id=account_id)
            .on_conflict_do_nothing(constraint="uix_channels_name_external_id")
            .returning(Channel.id)
        )
        result = await session.execute(stmt)
        channel_id = result.scalar_one_or_none()

        if channel_id is not None:
            channel = await session.get(Channel, channel_id)
            logger.info(
                "channel_created",
                extra={
                    "source": self.SOURCE,
                    "account_id": account_id,
                    "channel_id": str(channel.id),
                },
            )
            return channel, True

        select_stmt = select(Channel).where(
            Channel.name == self.SOURCE,
            Channel.external_account_id == account_id,
        )
        channel = (await session.execute(select_stmt)).scalar_one()
        logger.info(
            "channel_reused",
            extra={
                "source": self.SOURCE,
                "account_id": account_id,
                "channel_id": str(channel.id),
            },
        )
        return channel, False

    async def _get_or_create_client(
        self,
        session: AsyncSession,
        user_id: str,
    ) -> Tuple[Client, bool]:
        stmt = (
            insert(Client)
            .values(
                name=f"Avito User {user_id}",
                phone=None,
                external_source=self.SOURCE,
                external_user_id=user_id,
            )
            .on_conflict_do_nothing(constraint="uq_client_ext_source_id")
            .returning(Client.id)
        )
        result = await session.execute(stmt)
        client_id = result.scalar_one_or_none()

        if client_id is not None:
            client = await session.get(Client, client_id)
            logger.info(
                "client_created",
                extra={
                    "source": self.SOURCE,
                    "external_user_id": user_id,
                    "client_id": str(client.id),
                },
            )
            return client, True

        select_stmt = select(Client).where(
            Client.external_source == self.SOURCE,
            Client.external_user_id == user_id,
        )
        client = (await session.execute(select_stmt)).scalar_one()
        logger.info(
            "client_reused",
            extra={
                "source": self.SOURCE,
                "external_user_id": user_id,
                "client_id": str(client.id),
            },
        )
        return client, False

    async def _get_or_create_dialogue(
        self,
        session: AsyncSession,
        channel: Channel,
        client: Client,
        external_dialog_id: str,
    ) -> Tuple[Dialogue, bool]:
        now = datetime.now(timezone.utc)
        stmt = (
            insert(Dialogue)
            .values(
                channel_id=channel.id,
                external_dialog_id=external_dialog_id,
                client_id=client.id,
                status="open",
                last_message_at=now,
            )
            .on_conflict_do_nothing(constraint="uix_dialogues_channel_external_id")
            .returning(Dialogue.id)
        )
        result = await session.execute(stmt)
        dialogue_id = result.scalar_one_or_none()

        if dialogue_id is not None:
            dialogue = await session.get(Dialogue, dialogue_id)
            logger.info(
                "dialogue_created",
                extra={
                    "source": self.SOURCE,
                    "account_id": channel.external_account_id,
                    "external_dialog_id": external_dialog_id,
                    "dialogue_id": str(dialogue.id),
                },
            )
            return dialogue, True

        select_stmt = select(Dialogue).where(
            Dialogue.channel_id == channel.id,
            Dialogue.external_dialog_id == external_dialog_id,
        )
        dialogue = (await session.execute(select_stmt)).scalar_one()
        dialogue.last_message_at = now
        if dialogue.client_id is None:
            dialogue.client_id = client.id
        session.add(dialogue)
        logger.info(
            "dialogue_reused",
            extra={
                "source": self.SOURCE,
                "account_id": channel.external_account_id,
                "external_dialog_id": external_dialog_id,
                "dialogue_id": str(dialogue.id),
            },
        )
        return dialogue, False

    async def _create_message_if_not_exists(
        self,
        session: AsyncSession,
        dialogue: Dialogue,
        payload: AvitoWebhookPayload,
        raw_payload: dict,
    ) -> bool:
        stmt = (
            insert(Message)
            .values(
                dialogue_id=dialogue.id,
                external_message_id=payload.payload.message_id,
                direction="inbound",
                message_type="text",
                text=payload.payload.text,
                raw_payload=raw_payload,
            )
            .on_conflict_do_nothing(constraint="uix_messages_dialogue_external_id")
            .returning(Message.id)
        )
        result = await session.execute(stmt)
        message_id = result.scalar_one_or_none()

        if message_id is None:
            logger.info(
                "duplicate_message",
                extra={
                    "source": self.SOURCE,
                    "dialogue_id": str(dialogue.id),
                    "external_message_id": payload.payload.message_id,
                },
            )
            return False

        logger.info(
            "message_created",
            extra={
                "source": self.SOURCE,
                "dialogue_id": str(dialogue.id),
                "external_message_id": payload.payload.message_id,
                "message_id": str(message_id),
            },
        )
        return True
