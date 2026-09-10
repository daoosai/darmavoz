from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, status
from redis.exceptions import RedisError

from app.services.redis_client import get_redis

ORDER_IDEMPOTENCY_PREFIX = "idempotency:order:"
ORDER_IDEMPOTENCY_TTL_SECONDS = 60 * 60
_PROCESSING_VALUE = "processing"


@dataclass(frozen=True)
class OrderIdempotencyReservation:
    cache_key: str
    existing_order_id: UUID | None = None


def _cache_key(idempotency_key: str) -> str:
    try:
        return f"{ORDER_IDEMPOTENCY_PREFIX}{UUID(idempotency_key.strip())}"
    except (AttributeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key must be a UUID.",
        ) from error


async def reserve_order_idempotency_key(
    idempotency_key: str | None,
) -> OrderIdempotencyReservation | None:
    if not idempotency_key:
        return None

    cache_key = _cache_key(idempotency_key)
    redis = get_redis()
    try:
        existing = await redis.get(cache_key)
        if existing and existing != _PROCESSING_VALUE:
            return OrderIdempotencyReservation(cache_key, UUID(existing))
        if existing == _PROCESSING_VALUE:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Order is already being created. Retry shortly.",
            )

        reserved = await redis.set(
            cache_key,
            _PROCESSING_VALUE,
            ex=ORDER_IDEMPOTENCY_TTL_SECONDS,
            nx=True,
        )
        if reserved:
            return OrderIdempotencyReservation(cache_key)

        existing = await redis.get(cache_key)
        if existing and existing != _PROCESSING_VALUE:
            return OrderIdempotencyReservation(cache_key, UUID(existing))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Order is already being created. Retry shortly.",
        )
    except RedisError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Order creation is temporarily unavailable. Retry shortly.",
        ) from error


async def complete_order_idempotency_key(
    reservation: OrderIdempotencyReservation | None,
    order_id: UUID,
) -> None:
    if reservation is None:
        return
    try:
        await get_redis().set(
            reservation.cache_key,
            str(order_id),
            ex=ORDER_IDEMPOTENCY_TTL_SECONDS,
        )
    except RedisError:
        # The order has already been committed. Do not turn a successful order
        # into a failed checkout only because the cache became unavailable.
        return


async def release_order_idempotency_key(
    reservation: OrderIdempotencyReservation | None,
) -> None:
    if reservation is None or reservation.existing_order_id is not None:
        return
    try:
        await get_redis().delete(reservation.cache_key)
    except RedisError:
        return
