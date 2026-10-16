"""Shared, atomic password-login limits; no raw logins or passwords in Redis."""

import asyncio
import hashlib
import hmac
import ipaddress
import socket

from fastapi import HTTPException, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import settings

IP_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if count > tonumber(ARGV[2]) then return redis.call('TTL', KEYS[1]) end
return 0
"""
ATTEMPT_SCRIPT = """
local now = tonumber(redis.call('TIME')[1])
local wait = tonumber(redis.call('GET', KEYS[2]) or '0') - now
if wait > 0 then return wait end
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[2]) then return redis.call('TTL', KEYS[1]) end
redis.call('INCR', KEYS[1])
if count == 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return 0
"""
FAILURE_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if count >= tonumber(ARGV[2]) then
  local delay = math.min(tonumber(ARGV[3]), 2 ^ math.min(5,
      math.floor((count - tonumber(ARGV[2])) / 5)))
  local now = tonumber(redis.call('TIME')[1])
  redis.call('SET', KEYS[2], now + delay, 'EX', delay)
end
return 0
"""


def _digest(value: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode(),
        value.encode(),
        hashlib.sha256,
    ).hexdigest()


def _key(kind: str, value: str) -> str:
    return f"{settings.AUTH_LOGIN_NAMESPACE}:{kind}:{_digest(value)}"


async def _eval(script: str, keys: list[str], *args) -> int:
    try:
        # Per-operation pool also works with separate event loops in test workers.
        async with Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        ) as redis:
            return int(await redis.eval(script, len(keys), *keys, *args))
    except (RedisError, OSError) as exc:
        raise HTTPException(
            503,
            "Вход временно недоступен. Повторите попытку позже.",
            headers={"Retry-After": "5"},
        ) from exc


def _limited(wait: int) -> None:
    if wait:
        raise HTTPException(
            429,
            "Слишком много попыток входа. Попробуйте позже.",
            headers={"Retry-After": str(max(1, wait))},
        )


async def client_ip(request: Request) -> str:
    """Only our explicitly named proxy may supply X-Forwarded-For.

    Resolve the proxy on each login so Docker recreation cannot leave stale trust.
    Never trust the whole shared Docker subnet or arbitrary forwarding headers.
    """
    peer = request.client.host if request.client else "unknown"
    trusted = set()
    for host in settings.AUTH_LOGIN_TRUSTED_PROXY_HOSTS.split(","):
        host = host.strip()
        if not host:
            continue
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(
                host,
                None,
                type=socket.SOCK_STREAM,
            )
            trusted.update(info[4][0] for info in infos)
        except OSError:
            continue
    if peer not in trusted:
        return peer
    chain = request.headers.get("x-forwarded-for", "").split(",")
    try:
        for value in reversed(chain):
            address = str(ipaddress.ip_address(value.strip()))
            if address not in trusted:
                return address
    except ValueError:
        pass
    return peer


async def guard_ip(request: Request) -> str:
    address = await client_ip(request)
    wait = await _eval(
        IP_SCRIPT,
        [_key("ip", address)],
        settings.AUTH_LOGIN_IP_WINDOW_SECONDS,
        settings.AUTH_LOGIN_IP_LIMIT,
    )
    _limited(wait)
    return address


class LoginAttempt:
    def __init__(self, identity: str, address: str):
        self.pair = _key("pair", identity + "\0" + address)
        self.account = _key("account", identity)
        self.delay = _key("delay", identity)

    async def reserve(self) -> None:
        # Reserve before bcrypt, so concurrent requests cannot pass the same slot.
        wait = await _eval(
            ATTEMPT_SCRIPT,
            [self.pair, self.delay],
            settings.AUTH_LOGIN_WINDOW_SECONDS,
            settings.AUTH_LOGIN_FAILURE_LIMIT,
        )
        _limited(wait)

    async def failed(self) -> None:
        await _eval(
            FAILURE_SCRIPT,
            [self.account, self.delay],
            settings.AUTH_LOGIN_WINDOW_SECONDS,
            settings.AUTH_LOGIN_ACCOUNT_DELAY_AFTER,
            settings.AUTH_LOGIN_MAX_DELAY_SECONDS,
        )

    async def succeeded(self) -> None:
        # Keep IP and aggregate controls; success clears this account/IP pair only.
        await _eval("return redis.call('DEL', KEYS[1])", [self.pair])
