from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.models import Driver, ModerationStatus, Role, User, Vehicle
from app.schemas.driver import DriverRegistrationResponse
from app.schemas.driver import DriverRegisterRequest
from app.security.auth import get_password_hash, verify_password
from app.security.jwt import create_access_token
from app.schemas.token import Token
from app.utils.phones import normalize_phone, normalize_phone_like_username

router = APIRouter()


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


@router.post("/driver/register", response_model=DriverRegistrationResponse, status_code=status.HTTP_201_CREATED)
async def driver_register(
    payload: DriverRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    normalized_phone = normalize_phone(payload.phone)

    existing_user = await db.scalar(select(User).where(User.username == normalized_phone))
    if existing_user is not None:
        raise HTTPException(
            status_code=409,
            detail=_error_detail("DRIVER_PHONE_ALREADY_EXISTS", "Пользователь с таким номером уже зарегистрирован"),
        )

    existing_driver = await db.scalar(select(Driver).where(Driver.phone == normalized_phone))
    if existing_driver is not None:
        raise HTTPException(
            status_code=409,
            detail=_error_detail("DRIVER_PHONE_ALREADY_EXISTS", "Пользователь с таким номером уже зарегистрирован"),
        )

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
            brand=payload.vehicle_brand,
            plate_number=payload.vehicle_plate_number,
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
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_error_detail("DRIVER_PHONE_ALREADY_EXISTS", "Пользователь с таким номером уже зарегистрирован"),
        ) from exc
    result = await db.execute(
        select(Driver)
        .options(selectinload(Driver.vehicle).selectinload(Vehicle.delivery_option))
        .where(Driver.id == driver.id)
    )
    driver = result.scalar_one()

    access_token = create_access_token(data={"sub": user.username, "role": role.name})
    return DriverRegistrationResponse(
        access_token=access_token,
        token_type="bearer",
        role=role.name,
        driver_id=driver.id,
        driver=driver,
    )

@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    normalized_username = normalize_phone_like_username(form_data.username)
    # Fetch user
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
    
    access_token = create_access_token(
        data={
            "sub": user.username,
            "role": user.role.name if user.role else None,
        }
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role.name if user.role else None,
        "driver_id": user.driver_profile.id if user.driver_profile else None,
    }
