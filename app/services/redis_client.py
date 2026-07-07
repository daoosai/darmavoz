from uuid import UUID

from redis.asyncio import Redis

from app.core.config import settings

_redis_client: Redis | None = None
DISPATCH_QUEUE_KEY = "dispatch:queue"


def get_redis() -> Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


async def enqueue_dispatch_order(order_id: UUID | str) -> None:
    await get_redis().rpush(DISPATCH_QUEUE_KEY, str(order_id))


async def pop_dispatch_orders(limit: int = 50) -> list[UUID]:
    order_ids: list[UUID] = []
    redis = get_redis()
    for _ in range(max(limit, 0)):
        raw_value = await redis.lpop(DISPATCH_QUEUE_KEY)
        if raw_value is None:
            break
        try:
            order_ids.append(UUID(str(raw_value)))
        except ValueError:
            continue
    return order_ids


async def close_redis() -> None:
    global _redis_client
    if _redis_client is not None:
        await _redis_client.close()
        _redis_client = None
