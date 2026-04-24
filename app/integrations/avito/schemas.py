from pydantic import BaseModel, ConfigDict

class AvitoWebhookPayloadData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    chat_id: str
    user_id: str
    message_id: str
    text: str

class AvitoWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: str
    account_id: str
    payload: AvitoWebhookPayloadData
