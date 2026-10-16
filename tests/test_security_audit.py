"""Security regressions use the disposable DB and isolated Redis namespaces."""

import asyncio
import base64
import hashlib
import hmac
import json
from datetime import timedelta
from uuid import uuid4

import jwt
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from redis.exceptions import ConnectionError
from starlette.requests import Request

from app.core.config import settings
from app.models.commerce import WholesaleRequest
from app.models.models import City
from app.schemas.quarry import QuarryCreate, QuarryUpdate
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token, decode_access_token
from app.services.login_throttle import LoginAttempt, client_ip
from sqlalchemy import select
from tests.test_sprint24_api import create_actor
from app.api.wholesale import today


def legacy_jose_token(payload):
    # The HS256 serialization used by the outgoing python-jose implementation.
    def encode(value):
        return base64.urlsafe_b64encode(value).rstrip(b"=")
    parts = [
        encode(
            json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode()
        ),
        encode(json.dumps(payload, separators=(",", ":")).encode()),
    ]
    signature = hmac.new(
        settings.SECRET_KEY.encode(), b".".join(parts), hashlib.sha256
    ).digest()
    return b".".join(parts + [encode(signature)]).decode()


def test_old_jose_token_survives_and_invalid_tokens_do_not():
    import time

    claims = {"sub": "legacy-user", "role": "admin", "exp": int(time.time()) + 300}
    assert decode_access_token(legacy_jose_token(claims)) == claims
    token = create_access_token({"sub": "current", "auth_version": 3})
    assert decode_access_token(token)["auth_version"] == 3
    for bad in [
        legacy_jose_token({**claims, "exp": 1}),
        jwt.encode(claims, "wrong-key", algorithm="HS256"),
        jwt.encode(claims, "", algorithm="none"),
        jwt.encode(claims, settings.SECRET_KEY, algorithm="HS384"),
        legacy_jose_token({"sub": "no-exp"}),
        "malformed",
    ]:
        with pytest.raises(jwt.InvalidTokenError):
            decode_access_token(bad)


@pytest.mark.asyncio
async def test_legacy_session_and_auth_version(client, session_factory):
    import time

    async with session_factory() as db:
        user, _ = await create_actor(db, "supplier")
        user.auth_version = 3
        await db.commit()
        claims = {
            "sub": user.username,
            "role": "supplier",
            "exp": int(time.time()) + 300,
            "auth_version": 3,
        }
    headers = {"Authorization": "Bearer " + legacy_jose_token(claims)}
    assert (await client.get("/api/v1/supplier/me", headers=headers)).status_code == 200
    headers["Authorization"] = "Bearer " + legacy_jose_token(
        {**claims, "auth_version": 2}
    )
    assert (await client.get("/api/v1/supplier/me", headers=headers)).status_code == 401


@pytest.mark.parametrize("schema", [QuarryCreate, QuarryUpdate])
@pytest.mark.parametrize(
    "field,value",
    [
        ("lat", "57.152"),
        ("lon", "65.54"),
        ("lat", True),
        ("lon", False),
        ("lat", 90.1),
        ("lon", -180.1),
        ("lat", float("nan")),
        ("lon", float("inf")),
        ("lat", []),
        ("lon", {}),
    ],
)
def test_bad_coordinates_are_validation_errors(schema, field, value):
    with pytest.raises(ValidationError):
        schema(name="Valid", **{field: value})


@pytest.mark.parametrize("schema", [QuarryCreate, QuarryUpdate])
def test_coordinate_boundaries_and_optional_values(schema):
    assert schema(name="Valid", lat=90, lon=-180).lat == 90
    assert schema(name="Valid", lat=None, lon=None).lat is None


@pytest.mark.asyncio
async def test_supplier_long_name_and_invalid_coordinates(client, session_factory):
    async with session_factory() as db:
        supplier, headers = await create_actor(db, "supplier")
        supplier.username = "+7999" + str(int(uuid4().hex[:7], 16)).zfill(8)
        supplier.display_name = "QA supplier"
        # Token created by create_actor refers to the original name.
        from app.security.jwt import create_access_token

        headers = {
            "Authorization": "Bearer "
            + create_access_token({"sub": supplier.username, "role": "supplier"})
        }
        await db.commit()
    for length in [100, 101, 255]:
        response = await client.post(
            "/api/v1/supplier/points",
            headers=headers,
            json={"name": "А" * length, "lat": 57.152, "lon": 65.54},
        )
        assert response.status_code == 201, response.text
        assert len(response.json()["short_name"]) == min(length, 100)
        point_id = response.json()["id"]
        changed = await client.patch(
            f"/api/v1/supplier/points/{point_id}",
            headers=headers,
            json={"name": "Б" * length},
        )
        assert changed.status_code == 200, changed.text
    for payload in [
        {"name": "А" * 256},
        {"name": "Valid", "short_name": "Б" * 101},
        {"name": "Valid", "lat": "57.152"},
        {"name": "   "},
    ]:
        assert (
            await client.post("/api/v1/supplier/points", headers=headers, json=payload)
        ).status_code == 422


@pytest.mark.asyncio
async def test_driver_cannot_publish_even_legacy_own_draft(client, session_factory):
    async with session_factory() as db:
        driver, headers = await create_actor(db, "driver")
        supplier, supplier_headers = await create_actor(db, "supplier")
        city = await db.scalar(select(City).where(City.is_active.is_(True)))
        payload = dict(
            city_id=str(city.id),
            material_name="QA sand",
            volume=10,
            unit="m3",
            pickup_address="QA pickup",
            delivery_address="QA delivery",
            starts_on=str(today()),
            ends_on=str(today() + timedelta(days=2)),
            price=1000,
            price_basis="m3",
            contact_name="QA",
            contact_phone="+79990000000",
        )
        legacy = WholesaleRequest(
            **{
                **payload,
                "city_id": city.id,
                "starts_on": today(),
                "ends_on": today() + timedelta(days=2),
            },
            author_id=driver.id,
            status="draft",
        )
        db.add(legacy)
        await db.commit()
        ident = str(legacy.id)
    assert (
        await client.get("/api/v1/wholesale-requests", headers=headers)
    ).status_code == 200
    for suffix in ["", "?draft=true"]:
        assert (
            await client.post(
                "/api/v1/wholesale-requests" + suffix, headers=headers, json=payload
            )
        ).status_code == 403
    assert (
        await client.put(
            f"/api/v1/wholesale-requests/{ident}", headers=headers, json=payload
        )
    ).status_code == 403
    for action in ["submit", "close"]:
        assert (
            await client.post(
                f"/api/v1/wholesale-requests/{ident}/{action}", headers=headers
            )
        ).status_code == 403
    assert (
        await client.post(
            "/api/v1/wholesale-requests?draft=true",
            headers=supplier_headers,
            json=payload,
        )
    ).status_code == 201


@pytest.mark.asyncio
async def test_password_throttle_and_success_clear(client, session_factory):
    async with session_factory() as db:
        user, _ = await create_actor(db, "admin")
        user.hashed_password = get_password_hash("correct-password")
        await db.commit()
        username = user.username
    # Successful password clears the pair, not the global IP budget.
    for _ in range(4):
        assert (
            await client.post(
                "/api/v1/auth/login", data={"username": username, "password": "wrong"}
            )
        ).status_code == 401
    assert (
        await client.post(
            "/api/v1/auth/login",
            data={"username": username, "password": "correct-password"},
        )
    ).status_code == 200
    for _ in range(5):
        assert (
            await client.post(
                "/api/v1/auth/login", data={"username": username, "password": "wrong"}
            )
        ).status_code == 401
    limited = await client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": "correct-password"},
    )
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0


@pytest.mark.asyncio
async def test_parallel_slots_are_atomic_and_expire(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_LOGIN_WINDOW_SECONDS", 1)
    attempt = LoginAttempt("concurrent-account", "192.0.2.1")
    results = await asyncio.gather(
        *(attempt.reserve() for _ in range(12)), return_exceptions=True
    )
    assert sum(result is None for result in results) == 5
    assert all(
        result is None
        or isinstance(result, HTTPException)
        and result.status_code == 429
        for result in results
    )
    await asyncio.sleep(1.1)
    await attempt.reserve()


@pytest.mark.asyncio
async def test_account_delay_limits_distributed_sources(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_LOGIN_ACCOUNT_DELAY_AFTER", 2)
    for ip in ["192.0.2.1", "192.0.2.2"]:
        attempt = LoginAttempt("distributed-account", ip)
        await attempt.reserve()
        await attempt.failed()
    with pytest.raises(HTTPException) as error:
        await LoginAttempt("distributed-account", "192.0.2.3").reserve()
    assert error.value.status_code == 429


@pytest.mark.asyncio
async def test_redis_outage_does_not_bypass_login(monkeypatch, client):
    def offline(*args, **kwargs):
        raise ConnectionError("unavailable")

    monkeypatch.setattr("app.services.login_throttle.Redis.from_url", offline)
    result = await client.post(
        "/api/v1/auth/login", data={"username": "none", "password": "none"}
    )
    assert result.status_code == 503


@pytest.mark.asyncio
async def test_ip_limit_and_forwarded_header_is_not_trusted(client, monkeypatch):
    monkeypatch.setattr(settings, "AUTH_LOGIN_IP_LIMIT", 2)
    for i in range(2):
        result = await client.post(
            "/api/v1/auth/login", data={"username": f"unknown-{i}", "password": "bad"}
        )
        assert result.status_code == 401
    result = await client.post(
        "/api/v1/auth/login",
        headers={"X-Forwarded-For": "192.0.2.77"},
        data={"username": "another", "password": "bad"},
    )
    assert result.status_code == 429
    request = Request(
        {
            "type": "http",
            "client": ("192.0.2.1", 1234),
            "headers": [(b"x-forwarded-for", b"198.51.100.9")],
        }
    )
    assert await client_ip(request) == "192.0.2.1"


@pytest.mark.asyncio
async def test_limits_still_block_during_last_fraction_of_window():
    from redis.asyncio import Redis
    from app.services.login_throttle import guard_ip, _key

    attempt = LoginAttempt("last-fraction", "192.0.2.88")
    request = Request({"type": "http", "client": ("192.0.2.88", 1234), "headers": []})
    async with Redis.from_url(settings.REDIS_URL) as redis:
        # Redis TTL rounds down to zero while the key still exists.
        await redis.set(attempt.pair, settings.AUTH_LOGIN_FAILURE_LIMIT, px=400)
        await redis.set(_key("ip", "192.0.2.88"), settings.AUTH_LOGIN_IP_LIMIT, px=400)
        assert await redis.ttl(attempt.pair) == 0
        for action in [attempt.reserve, lambda: guard_ip(request)]:
            with pytest.raises(HTTPException) as error:
                await action()
            assert error.value.status_code == 429
            assert error.value.headers["Retry-After"] == "1"
        await redis.delete(attempt.pair, _key("ip", "192.0.2.88"))
