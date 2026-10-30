from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from app.core.config import settings


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    from app.services.journey import mark_authenticated
    mark_authenticated(data)
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=10080)  # 7 days

    to_encode.update(
        {"exp": expire, "auth_version": int(to_encode.get("auth_version", 1))}
    )
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def decode_access_token(token: str) -> dict:
    """Validate legacy JOSE and current JWTs with the same key and algorithm.

    No key rotation or auth_version bump: active signed sessions survive migration.
    Never choose the algorithm from untrusted token headers.
    """
    return jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM],
        options={"require": ["exp"]},
    )
