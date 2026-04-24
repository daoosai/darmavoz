from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict

class AvitoWebhookPayload(BaseModel):
    """
    Базовая Pydantic схема для входящих вебхуков от Авито.
    Так как структура может меняться и зависит от типа события,
    мы оставляем схему максимально гибкой.
    """
    model_config = ConfigDict(extra="allow")

    # Основные поля, которые обычно присутствуют в вебхуках Авито (например, для сообщений)
    type: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    
    # Можно добавить другие известные поля верхнего уровня, если они есть
