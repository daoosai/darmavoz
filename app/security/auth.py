from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from passlib.context import CryptContext

from app.core.config import settings
from app.db.database import get_db
from app.models.models import Client, Driver, ModerationStatus, User
from app.schemas.token import TokenData

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

DISPATCH_ALLOWED_MODERATION_STATUSES = {
    ModerationStatus.approved.value,
    ModerationStatus.incomplete.value,
}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(
            username=username,
            role=payload.get("role"),
            client_id=payload.get("client_id"),
        )
    except JWTError:
        raise credentials_exception

    query = (
        select(User)
        .where(User.username == token_data.username)
        .options(
            selectinload(User.role),
            selectinload(User.driver_profile).selectinload(Driver.vehicle),
        )
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if user is None or not user.is_active or user.is_deleted:
        raise credentials_exception
    return user


async def get_current_client(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Client:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate client credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        token_data = TokenData(
            username=payload.get("sub"),
            role=payload.get("role"),
            client_id=payload.get("client_id"),
        )
    except JWTError:
        raise credentials_exception

    if token_data.role != "client" or token_data.client_id is None:
        raise credentials_exception

    client = await db.get(Client, token_data.client_id)
    if client is None or client.is_deleted:
        raise credentials_exception
    return client


async def get_optional_current_client(
    token: str | None = Depends(optional_oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Client | None:
    if token is None:
        return None
    return await get_current_client(token=token, db=db)


def require_roles(*allowed_roles: str) -> Callable:
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        role_name = current_user.role.name if current_user.role else None
        if role_name not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="The user doesn't have enough privileges",
            )
        return current_user

    return role_checker


get_current_admin_user = require_roles("admin")
get_current_logist_user = require_roles("admin", "logist")
get_current_manager_user = require_roles("admin", "manager")
get_current_driver_user = require_roles("driver")
get_current_supplier_user = require_roles("supplier")
get_current_equipment_owner_user = require_roles("equipment_owner")


async def get_current_driver(current_user: User = Depends(get_current_driver_user)) -> Driver:
    driver = current_user.driver_profile
    if driver is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Driver profile is not linked to the current user",
        )
    return driver


async def get_current_approved_driver(current_driver: Driver = Depends(get_current_driver)) -> Driver:
    vehicle = current_driver.vehicle
    if not current_driver.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Driver profile is inactive",
        )
    if current_driver.moderation_status not in DISPATCH_ALLOWED_MODERATION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Driver moderation is not approved",
        )
    if vehicle is not None and vehicle.moderation_status not in DISPATCH_ALLOWED_MODERATION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vehicle moderation is not approved",
        )
    return current_driver
