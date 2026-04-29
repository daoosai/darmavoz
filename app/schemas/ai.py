from enum import Enum
from pydantic import BaseModel, ConfigDict, Field


class MessageClassificationEnum(str, Enum):
    new_order = "new_order"
    order_update = "order_update"
    question = "question"
    irrelevant = "irrelevant"


class OrderExtractedFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material: str | None = Field(None, description="Материал заказа")
    volume: float | None = Field(None, description="Объем заказа")
    address: str | None = Field(None, description="Адрес доставки")
    datetime_str: str | None = Field(None, description="Желаемые дата и время")
    client_name: str | None = Field(None, description="Имя клиента")
    client_phone: str | None = Field(None, description="Номер телефона клиента")
    notes: str | None = Field(None, description="Дополнительные заметки")


class MessageAnalysisResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    classification: MessageClassificationEnum = Field(
        ..., description="Классификация сообщения: новый заказ, обновление заказа, вопрос, не относится к делу"
    )
    is_order_related: bool = Field(
        ..., description="Связано ли сообщение с оформлением заказа"
    )
    client_message_summary: str = Field(
        ..., description="Краткая выжимка (summary) сообщения клиента"
    )
    order_fields: OrderExtractedFields = Field(
        ..., description="Извлеченные поля заказа (могут быть пустыми)"
    )
    missing_fields: list[str] = Field(
        default_factory=list, description="Список недостающих полей (например: ['volume', 'address'])"
    )
    needs_clarification: bool = Field(
        ..., description="Требуется ли задать уточняющий вопрос клиенту"
    )
    should_create_order_draft: bool = Field(
        ..., description="True только если classification == new_order или order_update"
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Уверенность модели (от 0.0 до 1.0)"
    )
