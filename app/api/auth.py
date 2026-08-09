import json
import logging
import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import Client, Driver, ModerationStatus, Role, User, Vehicle
from app.schemas.email_auth import (
    EmailAuthResponse,
    EmailSendCodeRequest,
    EmailSendCodeResponse,
    EmailVerifyCodeRequest,
)
from app.schemas.driver import (
    DriverRegisterRequest,
    DriverRegistrationResponse,
    DriverSmsChallengeResponse,
    DriverVerifyCodeRequest,
)
from app.schemas.token import Token
from app.schemas.sprint19 import PasswordResetComplete, PasswordResetRequest, PasswordResetVerify, PasswordResetVerifyResponse
from app.security.auth import get_password_hash, verify_password
from app.security.jwt import create_access_token
from app.services.auth_email_service import send_auth_email_code
from app.services.redis_client import get_redis
from app.services.sms_service import generate_otp_code, normalize_sms_phone, send_auth_sms_code
from app.utils.phones import normalize_phone, normalize_phone_like_username

router = APIRouter()
logger = logging.getLogger(__name__)
driver_auth_router = APIRouter()

DRIVER_AUTH_CODE_TTL_SECONDS = 300
DRIVER_LOGIN_CODE_KEY_PREFIX = "otp:driver_login"
DRIVER_LOGIN_PENDING_KEY_PREFIX = "otp:driver_login_pending"
DRIVER_REGISTER_CODE_KEY_PREFIX = "otp:driver_register"
DRIVER_REGISTER_PENDING_KEY_PREFIX = "otp:driver_register_pending"
EMAIL_AUTH_CODE_TTL_SECONDS = 300
EMAIL_AUTH_CODE_KEY_PREFIX = "otp:email"
PASSWORD_RESET_CODE_PREFIX = "otp:password_reset"
PASSWORD_RESET_TOKEN_PREFIX = "password_reset:token"


def _error_detail(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _build_registration_vehicle_title(*, brand: str, plate_number: str) -> str:
    parts = [part.strip() for part in (brand, plate_number) if part.strip()]
    return " / ".join(parts) if parts else "Черновик машины"


def _blocked_profile_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=_error_detail("USER_BLOCKED", "Ваш профиль заблокирован. Обратитесь в поддержку."),
    )


async def _get_or_create_driver_role(db: AsyncSession) -> Role:
    role = await db.scalar(select(Role).where(Role.name == "driver"))
    if role is None:
        role = Role(name="driver", description="Driver application user")
        db.add(role)
        await db.flush()
    return role


def _driver_login_code_key(phone: str) -> str:
    return f"{DRIVER_LOGIN_CODE_KEY_PREFIX}:{phone}"


def _driver_login_pending_key(phone: str) -> str:
    return f"{DRIVER_LOGIN_PENDING_KEY_PREFIX}:{phone}"


def _driver_register_code_key(phone: str) -> str:
    return f"{DRIVER_REGISTER_CODE_KEY_PREFIX}:{phone}"


def _driver_register_pending_key(phone: str) -> str:
    return f"{DRIVER_REGISTER_PENDING_KEY_PREFIX}:{phone}"


def _email_auth_code_key(scope: str, email: str) -> str:
    return f"{EMAIL_AUTH_CODE_KEY_PREFIX}:{scope}:{email}"


def _password_reset_code_key(email: str) -> str:
    return f"{PASSWORD_RESET_CODE_PREFIX}:{email}"


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(payload: PasswordResetRequest, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    email = payload.email.strip().lower()
    user = await _get_user_by_email(db, email)
    if user and user.is_active and not user.is_deleted and user.role and user.role.name in {"admin", "logist"}:
        code = generate_otp_code()
        await get_redis().setex(_password_reset_code_key(email), 300, code)
        logger.warning("Password reset OTP for %s: %s", email, code)
        background_tasks.add_task(send_auth_email_code, to_email=email, code=code)
    return {"ok": True, "status": "email_sent"}


@router.post("/password-reset/verify", response_model=PasswordResetVerifyResponse)
async def verify_password_reset(payload: PasswordResetVerify, db: AsyncSession = Depends(get_db)) -> PasswordResetVerifyResponse:
    email = payload.email.strip().lower(); redis = get_redis()
    code = await redis.get(_password_reset_code_key(email))
    user = await _get_user_by_email(db, email)
    if code is None or payload.code.strip() != code or user is None or not user.role or user.role.name not in {"admin", "logist"}:
        raise HTTPException(status_code=400, detail="Неверный или истёкший код")
    token = secrets.token_urlsafe(32)
    await redis.delete(_password_reset_code_key(email))
    await redis.setex(f"{PASSWORD_RESET_TOKEN_PREFIX}:{token}", 600, str(user.id))
    return PasswordResetVerifyResponse(
        reset_token=token,
        role=user.role.name,
        name=user.display_name,
        email=user.email,
    )


@router.post("/password-reset/complete")
async def complete_password_reset(payload: PasswordResetComplete, db: AsyncSession = Depends(get_db)):
    redis = get_redis(); user_id = await redis.get(f"{PASSWORD_RESET_TOKEN_PREFIX}:{payload.reset_token}")
    if user_id is None: raise HTTPException(status_code=400, detail="Ссылка сброса истекла")
    user = await db.get(User, user_id)
    if user is None or not user.is_active or user.is_deleted: raise HTTPException(status_code=400, detail="Аккаунт недоступен")
    user.hashed_password = get_password_hash(payload.new_password); user.auth_version += 1
    await redis.delete(f"{PASSWORD_RESET_TOKEN_PREFIX}:{payload.reset_token}")
    await db.commit(); return {"ok": True}


def _default_client_name_from_email(email: str) -> str:
    local_part = email.split("@", 1)[0].strip()
    normalized = local_part.replace(".", " ").replace("_", " ").replace("-", " ").strip()
    return normalized[:255] or "Клиент"


def _build_email_auth_response(*, user: User) -> EmailAuthResponse:
    role_name = user.role.name if user.role else ""
    return EmailAuthResponse(
        access_token=create_access_token(
            data={
                "sub": user.username,
                "role": role_name,
                "auth_version": user.auth_version,
            }
        ),
        role=role_name,
        driver_id=user.driver_profile.id if user.driver_profile else None,
    )


async def _get_or_create_supplier_role(db: AsyncSession) -> Role:
    role = await db.scalar(select(Role).where(Role.name == "supplier"))
    if role is None:
        role = Role(name="supplier", description="Pickup point owner")
        db.add(role)
        await db.flush()
    return role


async def _get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User)
        .where(func.lower(User.email) == email)
        .options(selectinload(User.role), selectinload(User.driver_profile))
    )
    return result.scalar_one_or_none()


async def _get_client_by_email(db: AsyncSession, email: str) -> Client | None:
    return await db.scalar(select(Client).where(func.lower(Client.email) == email))


def _ensure_user_can_authenticate(user: User) -> None:
    if not user.is_active:
        raise _blocked_profile_exception()
    if user.driver_profile is not None and user.driver_profile.moderation_status == ModerationStatus.suspended.value:
        raise _blocked_profile_exception()


async def _ensure_driver_phone_is_available(db: AsyncSession, normalized_phone: str) -> None:
    existing_user = await db.scalar(select(User).where(User.username == normalized_phone))
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_error_detail("DRIVER_PHONE_ALREADY_EXISTS", "Пользователь с таким номером уже зарегистрирован"),
        )

    existing_driver = await db.scalar(select(Driver).where(Driver.phone == normalized_phone))
    if existing_driver is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_error_detail("DRIVER_PHONE_ALREADY_EXISTS", "Пользователь с таким номером уже зарегистрирован"),
        )


async def _create_driver_from_payload(
    db: AsyncSession,
    *,
    payload: DriverRegisterRequest,
    normalized_phone: str,
) -> tuple[Role, Driver, User]:
    role = await _get_or_create_driver_role(db)
    user = User(
        username=normalized_phone,
        hashed_password=get_password_hash(payload.password),
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    vehicle = Vehicle(
        title=_build_registration_vehicle_title(
            brand=payload.vehicle_brand or "",
            plate_number=payload.vehicle_plate_number or "",
        ),
        brand=payload.vehicle_brand,
        plate_number=payload.vehicle_plate_number,
        vehicle_type=payload.vehicle_type,
        cubature_min=payload.cubature_min,
        cubature_max=payload.cubature_max,
        tonnage_min=payload.tonnage_min,
        tonnage_max=payload.tonnage_max,
        moderation_status=ModerationStatus.incomplete.value,
        is_active=True,
    )
    db.add(vehicle)
    await db.flush()

    driver = Driver(
        name=payload.name,
        phone=normalized_phone,
        user_id=user.id,
        vehicle_id=vehicle.id,
        status="offline",
        is_auto_dispatch_enabled=True,
        dispatch_priority=100,
        moderation_status=ModerationStatus.incomplete.value,
    )
    db.add(driver)
    await db.commit()

    result = await db.execute(
        select(Driver)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.id == driver.id)
    )
    persisted_driver = result.scalar_one()
    return role, persisted_driver, user


def _build_driver_registration_response(*, role: Role, user: User, driver: Driver) -> DriverRegistrationResponse:
    access_token = create_access_token(data={"sub": user.username, "role": role.name, "auth_version": user.auth_version})
    return DriverRegistrationResponse(
        access_token=access_token,
        token_type="bearer",
        role=role.name,
        driver_id=driver.id,
        driver=driver,
    )


async def _issue_driver_login_code(*, normalized_phone: str, user_id: str) -> DriverSmsChallengeResponse:
    code = generate_otp_code()
    sms_phone = normalize_sms_phone(normalized_phone)
    stored_code = await send_auth_sms_code(phone_number=sms_phone, code=code, log_prefix="driver_login_sms_auth")

    redis = get_redis()
    await redis.setex(_driver_login_code_key(normalized_phone), DRIVER_AUTH_CODE_TTL_SECONDS, stored_code)
    await redis.setex(_driver_login_pending_key(normalized_phone), DRIVER_AUTH_CODE_TTL_SECONDS, user_id)
    return DriverSmsChallengeResponse(status="sms_sent", phone=normalized_phone)


@router.post("/email/send-code", response_model=EmailSendCodeResponse)
async def send_email_code(
    payload: EmailSendCodeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> EmailSendCodeResponse:
    normalized_email = payload.email
    is_new_user: bool | None = None

    if payload.auth_scope == "client":
        client = await _get_client_by_email(db, normalized_email)
        is_new_user = client is None
    elif payload.auth_scope == "supplier":
        user = await _get_user_by_email(db, normalized_email)
        if user is not None and (user.role is None or user.role.name != "supplier"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот email уже используется в другом аккаунте")
        is_new_user = user is None
    else:
        user = await _get_user_by_email(db, normalized_email)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь с таким email не найден")
        _ensure_user_can_authenticate(user)

    code = generate_otp_code()
    await get_redis().setex(
        _email_auth_code_key(payload.auth_scope, normalized_email),
        EMAIL_AUTH_CODE_TTL_SECONDS,
        code,
    )
    background_tasks.add_task(send_auth_email_code, to_email=normalized_email, code=code)

    return EmailSendCodeResponse(
        email=normalized_email,
        is_new_user=is_new_user,
    )


@router.post("/email/verify", response_model=EmailAuthResponse)
async def verify_email_code(
    payload: EmailVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
) -> EmailAuthResponse:
    normalized_email = payload.email
    redis = get_redis()
    saved_code = await redis.get(_email_auth_code_key(payload.auth_scope, normalized_email))

    if saved_code is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код истек или не запрашивался")
    if payload.code.strip() != saved_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный код")

    if payload.auth_scope == "client":
        client = await _get_client_by_email(db, normalized_email)
        if client is None:
            client = Client(
                name=_default_client_name_from_email(normalized_email),
                email=normalized_email,
                phone=None,
            )
            db.add(client)
            await db.commit()
            await db.refresh(client)

        await redis.delete(_email_auth_code_key(payload.auth_scope, normalized_email))
        return EmailAuthResponse(
            access_token=create_access_token(
                data={
                    "sub": normalized_email,
                    "role": "client",
                    "client_id": str(client.id),
                    "auth_version": client.auth_version,
                }
            ),
            role="client",
            client_id=client.id,
        )

    if payload.auth_scope == "supplier":
        user = await _get_user_by_email(db, normalized_email)
        if user is None:
            role = await _get_or_create_supplier_role(db)
            user = User(
                username=normalized_email,
                email=normalized_email,
                hashed_password=get_password_hash(secrets.token_urlsafe(32)),
                role_id=role.id,
                is_active=True,
            )
            db.add(user)
            try:
                await db.commit()
            except IntegrityError as exc:
                await db.rollback()
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот email уже используется в другом аккаунте") from exc
            await db.refresh(user)
            user = await _get_user_by_email(db, normalized_email)
        elif user.role is None or user.role.name != "supplier":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот email уже используется в другом аккаунте")

        _ensure_user_can_authenticate(user)
        await redis.delete(_email_auth_code_key(payload.auth_scope, normalized_email))
        return _build_email_auth_response(user=user)

    user = await _get_user_by_email(db, normalized_email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь с таким email не найден")

    _ensure_user_can_authenticate(user)
    await redis.delete(_email_auth_code_key(payload.auth_scope, normalized_email))
    return _build_email_auth_response(user=user)


@router.post("/driver/register", response_model=DriverSmsChallengeResponse, status_code=status.HTTP_202_ACCEPTED)
async def driver_register(
    payload: DriverRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = normalize_phone(payload.phone)
    await _ensure_driver_phone_is_available(db, normalized_phone)

    code = generate_otp_code()
    sms_phone = normalize_sms_phone(normalized_phone)
    stored_code = await send_auth_sms_code(phone_number=sms_phone, code=code, log_prefix="driver_register_sms_auth")

    redis = get_redis()
    await redis.setex(_driver_register_code_key(normalized_phone), DRIVER_AUTH_CODE_TTL_SECONDS, stored_code)
    await redis.setex(
        _driver_register_pending_key(normalized_phone),
        DRIVER_AUTH_CODE_TTL_SECONDS,
        payload.model_copy(update={"phone": normalized_phone}).model_dump_json(),
    )
    return DriverSmsChallengeResponse(status="sms_sent", phone=normalized_phone)


@router.post("/login", response_model=Token | DriverSmsChallengeResponse)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    normalized_username = normalize_phone_like_username(form_data.username)
    query = (
        select(User)
        .where(User.username == normalized_username)
        .options(selectinload(User.role), selectinload(User.driver_profile))
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_error_detail("INVALID_CREDENTIALS", "Неверный логин или пароль"),
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise _blocked_profile_exception()
    if user.driver_profile is not None and user.driver_profile.moderation_status == ModerationStatus.suspended.value:
        raise _blocked_profile_exception()

    role_name = user.role.name if user.role else None
    if role_name == "driver":
        return await _issue_driver_login_code(
            normalized_phone=normalized_username,
            user_id=str(user.id),
        )

    access_token = create_access_token(
        data={
                "sub": user.username,
                "role": role_name,
                "auth_version": user.auth_version,
        }
    )
    return Token(
        access_token=access_token,
        token_type="bearer",
        role=role_name,
        driver_id=user.driver_profile.id if user.driver_profile else None,
    )


@driver_auth_router.post("/api/v1/driver/auth/verify-login", response_model=Token)
async def verify_driver_login(
    payload: DriverVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = normalize_phone(payload.phone)
    redis = get_redis()
    saved_code = await redis.get(_driver_login_code_key(normalized_phone))
    pending_user_id = await redis.get(_driver_login_pending_key(normalized_phone))

    if saved_code is None or pending_user_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код истек или не запрашивался")
    if payload.code.strip() != saved_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный код")

    result = await db.execute(
        select(User)
        .where(User.username == normalized_phone)
        .options(selectinload(User.role), selectinload(User.driver_profile))
    )
    user = result.scalar_one_or_none()
    if user is None or str(user.id) != pending_user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    if not user.is_active:
        raise _blocked_profile_exception()
    if user.driver_profile is not None and user.driver_profile.moderation_status == ModerationStatus.suspended.value:
        raise _blocked_profile_exception()

    access_token = create_access_token(
        data={
            "sub": user.username,
            "role": user.role.name if user.role else None,
            "auth_version": user.auth_version,
        }
    )
    await redis.delete(_driver_login_code_key(normalized_phone))
    await redis.delete(_driver_login_pending_key(normalized_phone))

    return Token(
        access_token=access_token,
        token_type="bearer",
        role=user.role.name if user.role else None,
        driver_id=user.driver_profile.id if user.driver_profile else None,
    )


@driver_auth_router.post("/api/v1/driver/auth/verify-register", response_model=DriverRegistrationResponse)
async def verify_driver_register(
    payload: DriverVerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = normalize_phone(payload.phone)
    redis = get_redis()
    saved_code = await redis.get(_driver_register_code_key(normalized_phone))
    pending_payload_raw = await redis.get(_driver_register_pending_key(normalized_phone))

    if saved_code is None or pending_payload_raw is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код истек или не запрашивался")
    if payload.code.strip() != saved_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный код")

    try:
        pending_payload = DriverRegisterRequest.model_validate(json.loads(pending_payload_raw))
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Заявка на регистрацию повреждена") from exc

    await _ensure_driver_phone_is_available(db, normalized_phone)
    try:
        role, driver, user = await _create_driver_from_payload(
            db,
            payload=pending_payload,
            normalized_phone=normalized_phone,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_error_detail("DRIVER_PHONE_ALREADY_EXISTS", "Пользователь с таким номером уже зарегистрирован"),
        ) from exc

    await redis.delete(_driver_register_code_key(normalized_phone))
    await redis.delete(_driver_register_pending_key(normalized_phone))
    return _build_driver_registration_response(role=role, user=user, driver=driver)
