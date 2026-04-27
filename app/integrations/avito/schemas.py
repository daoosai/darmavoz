from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

class AvitoWebhookPayloadData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    chat_id: str
    user_id: str
    sender_user_id: str
    message_id: str
    text: str | None = None
    direction: str = "inbound"
    message_type: str = "text"

class AvitoWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: str
    account_id: str
    payload: AvitoWebhookPayloadData

    @model_validator(mode="before")
    @classmethod
    def normalize_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        if "event_id" in data and "account_id" in data:
            payload = data.get("payload") or {}
            if "sender_user_id" not in payload and "user_id" in payload:
                payload = {
                    **payload,
                    "sender_user_id": str(payload["user_id"]),
                    "direction": payload.get("direction", "inbound"),
                    "message_type": payload.get("message_type", "text"),
                }
            return {**data, "payload": payload}

        payload_wrapper = data.get("payload") or {}
        payload_value = payload_wrapper.get("value") or {}
        content = payload_value.get("content") or {}

        recipient_user_id = str(payload_value.get("user_id") or "")
        author_id = str(payload_value.get("author_id") or "")
        direction_value = payload_value.get("direction")

        if not direction_value:
            direction_value = "outbound" if recipient_user_id == author_id else "inbound"
        elif direction_value == "in":
            direction_value = "inbound"
        elif direction_value == "out":
            direction_value = "outbound"

        message_id = str(payload_value.get("id") or data.get("id") or "")

        return {
            "event_id": str(data.get("id") or message_id),
            "account_id": str(data.get("account_id") or recipient_user_id),
            "payload": {
                "chat_id": str(payload_value.get("chat_id") or ""),
                "user_id": recipient_user_id,
                "sender_user_id": author_id,
                "message_id": message_id,
                "text": content.get("text"),
                "direction": direction_value,
                "message_type": str(payload_value.get("type") or "text"),
            },
        }

    @model_validator(mode="after")
    def validate_required_fields(self) -> "AvitoWebhookPayload":
        required_values = {
            "event_id": self.event_id,
            "account_id": self.account_id,
            "chat_id": self.payload.chat_id,
            "sender_user_id": self.payload.sender_user_id,
            "message_id": self.payload.message_id,
        }
        missing = [name for name, value in required_values.items() if not str(value or "").strip()]
        if missing:
            raise ValueError(f"Missing required webhook fields: {', '.join(missing)}")
        return self
