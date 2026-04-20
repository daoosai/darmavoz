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
from app.models.models import User
from app.schemas.token import TokenData

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


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
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception

    query = select(User).where(User.username == token_data.username).options(selectinload(User.role))
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise credentials_exception
    return user


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
