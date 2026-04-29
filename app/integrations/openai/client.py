import logging

from openai import AsyncOpenAI

from app.core.config import settings
from app.schemas.ai import MessageAnalysisResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Ты логистический ИИ-ассистент. Твоя задача - классифицировать сообщение и извлечь параметры заказа на доставку сыпучих материалов.
Правила:
1. НИКОГДА не выдумывай данные. Если поля нет в тексте - возвращай null.
2. Если объем или другие параметры указаны неточно, двусмысленно (например, 'камаз', 'машина') или отсутствуют — возвращай null для этого поля и ОБЯЗАТЕЛЬНО добавляй название этого поля в список missing_fields. Не угадывай и не додумывай значения.
3. missing_fields - укажи ключи полей, которые нужны для полного заказа, но клиент их не назвал.
4. should_create_order_draft - True, только если это новый заказ или дополнение."""


class OpenAIClient:
    def __init__(self) -> None:
        self.last_raw_response: str | None = None
        self.client: AsyncOpenAI | None = None
        if settings.LLM_API_KEY:
            self.client = AsyncOpenAI(
                api_key=settings.LLM_API_KEY,
                base_url=settings.LLM_BASE_URL,
                max_retries=settings.LLM_MAX_RETRIES,
                timeout=settings.LLM_TIMEOUT_SECONDS,
            )

    async def analyze_message(self, text: str, context: str = "") -> MessageAnalysisResult:
        if not settings.LLM_API_KEY:
            raise ValueError("LLM_API_KEY is not configured")
        if self.client is None:
            self.client = AsyncOpenAI(
                api_key=settings.LLM_API_KEY,
                base_url=settings.LLM_BASE_URL,
                max_retries=settings.LLM_MAX_RETRIES,
                timeout=settings.LLM_TIMEOUT_SECONDS,
            )

        self.last_raw_response = None
        user_prompt = self._build_user_prompt(text=text, context=context)
        logger.info(
            "openai_message_analysis_started",
            extra={
                "model": settings.LLM_MODEL,
                "has_context": bool(context.strip()),
            },
        )

        completion = await self.client.beta.chat.completions.parse(
            model=settings.LLM_MODEL,
            temperature=settings.LLM_TEMPERATURE,
            response_format=MessageAnalysisResult,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        self.last_raw_response = completion.model_dump_json()

        message = completion.choices[0].message
        if message.parsed is not None:
            return message.parsed

        if getattr(message, "refusal", None):
            raise ValueError(f"OpenAI refusal: {message.refusal}")

        raise ValueError("OpenAI returned no structured response")

    @staticmethod
    def _build_user_prompt(text: str, context: str) -> str:
        normalized_text = text.strip() or "[empty message]"
        normalized_context = context.strip() or "Контекст отсутствует."
        return (
            "Проанализируй входящее сообщение клиента и верни строго валидный JSON по схеме.\n\n"
            f"Контекст диалога:\n{normalized_context}\n\n"
            f"Текущее сообщение:\n{normalized_text}"
        )
