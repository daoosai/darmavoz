from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services import order_idempotency


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, *, ex: int, nx: bool = False) -> bool:
        del ex
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def delete(self, key: str) -> int:
        return int(self.values.pop(key, None) is not None)


@pytest.mark.asyncio
async def test_order_idempotency_returns_saved_order_for_repeated_key(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(order_idempotency, "get_redis", lambda: redis)
    request_key = str(uuid4())
    order_id = uuid4()

    client_id = uuid4()
    reservation = await order_idempotency.reserve_order_idempotency_key(request_key, client_id=client_id)
    assert reservation is not None
    assert reservation.existing_order_id is None

    await order_idempotency.complete_order_idempotency_key(reservation, order_id)
    repeated = await order_idempotency.reserve_order_idempotency_key(request_key, client_id=client_id)

    assert repeated is not None
    assert repeated.existing_order_id == order_id


@pytest.mark.asyncio
async def test_order_idempotency_blocks_parallel_request(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(order_idempotency, "get_redis", lambda: redis)
    request_key = str(uuid4())

    client_id = uuid4()
    await order_idempotency.reserve_order_idempotency_key(request_key, client_id=client_id)

    with pytest.raises(HTTPException) as error:
        await order_idempotency.reserve_order_idempotency_key(request_key, client_id=client_id)
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_order_idempotency_is_scoped_to_client(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(order_idempotency, "get_redis", lambda: redis)
    request_key = str(uuid4())
    first_client_id = uuid4()
    second_client_id = uuid4()

    reservation = await order_idempotency.reserve_order_idempotency_key(
        request_key,
        client_id=first_client_id,
    )
    assert reservation is not None
    await order_idempotency.complete_order_idempotency_key(reservation, uuid4())

    second_client_reservation = await order_idempotency.reserve_order_idempotency_key(
        request_key,
        client_id=second_client_id,
    )
    assert second_client_reservation is not None
    assert second_client_reservation.existing_order_id is None
