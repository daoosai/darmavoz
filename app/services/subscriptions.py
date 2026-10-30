"""Central subscription policy. A role, moderation or client clock never grants paid access."""
import calendar
import hashlib
import hmac
import re
import unicodedata
from datetime import UTC, datetime, timedelta
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from app.core.config import settings
from app.models.models import Driver, Vehicle, User
from app.models.subscriptions import (SprintSetting, SubscriptionPlan, CategoryAccess, TrialIdentity,
    AccessGrant, VehicleMembership, VehicleTrial, SubscriptionAudit)

CATEGORIES = {
    "quarry": ("Карьеры", {"supplier"}), "accumulator": ("Накопители", {"supplier"}),
    "driver": ("Водители", {"driver"}), "carrier": ("Перевозчики", {"driver"}),
    "equipment": ("Спецтехника", {"equipment_owner", "supplier"}),
    "water": ("Вода", {"water_septic_partner"}), "firewood": ("Дрова", {"supplier"}),
    "septic": ("Септики", {"water_septic_partner"}),
}
DEFAULTS = {"enabled": False, "direct_orders": False, "water_paid_only": False,
    "chat_enabled": False, "journey_enabled": False, "login_idle_minutes": 10,
    "order_idle_minutes": 30, "payment_idle_minutes": 30, "event_days": 90, "contact_days": 30,
    "input_group_minutes": 5, "dispatch_retry_seconds": 60, "owner_id": None,
    "notify_push": True, "notify_inapp": True, "notify_abandoned": False, "chat_rules": "",
    "notify_events": ["technical_error", "provider_rejected", "auth_failed", "order_failed"],
}
TRANSPORT = ("driver", "carrier")


def now():
    return datetime.now(UTC)


def error(code, message, status=403):
    raise HTTPException(status, {"code": code, "message": message})


async def config(db):
    row = await db.get(SprintSetting, "platform")
    return {**DEFAULTS, **(row.value if row else {})}


async def enabled(db):
    return bool((await config(db))["enabled"])


def identity_key(value):
    normalized = unicodedata.normalize("NFKC", str(value)).strip().lower()
    if re.fullmatch(r"[+\d\s()\-]+", normalized):
        normalized = re.sub(r"\D", "", normalized)
        if len(normalized) == 11 and normalized.startswith("8"):
            normalized = "7" + normalized[1:]
    return hmac.new(settings.SECRET_KEY.encode(), ("s26-identity:"+normalized).encode(), hashlib.sha256).hexdigest()


def normalize_plate(value):
    value = unicodedata.normalize("NFKC", value or "").upper()
    value = value.translate(str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX"))
    value = re.sub(r"[\s.\-]", "", value)
    value = re.sub(r"RUS$", "", value)
    if not re.fullmatch(r"[ABEKMHOPCTYX]\d{3}[ABEKMHOPCTYX]{2}\d{2,3}", value):
        error("PLATE_REVIEW_REQUIRED", "Для пробного доступа проверьте госномер машины у администратора", 422)
    return value


def plate_key(value):
    return identity_key("plate:" + normalize_plate(value))


def add_months(value, months):
    total = value.year * 12 + value.month - 1 + months
    year, month = divmod(total, 12)
    month += 1
    return value.replace(year=year, month=month, day=min(value.day, calendar.monthrange(year, month)[1]))


def audit(db, actor_id, account_id, action, **details):
    db.add(SubscriptionAudit(actor_id=actor_id, account_id=account_id, action=action, details=details))


async def account_category(db, account_id, category, lock=False):
    if category not in CATEGORIES:
        error("UNKNOWN_CATEGORY", "Категория не найдена", 422)
    await db.execute(insert(CategoryAccess).values(account_id=account_id, category=category)
                     .on_conflict_do_nothing(index_elements=["account_id", "category"]))
    query = select(CategoryAccess).where(CategoryAccess.account_id==account_id, CategoryAccess.category==category)
    if lock: query=query.with_for_update()
    return await db.scalar(query.execution_options(populate_existing=True))


async def grant_end(db, account_id, category, at=None):
    at=at or now()
    return await db.scalar(select(func.max(AccessGrant.ends_at)).where(
        AccessGrant.account_id==account_id, AccessGrant.category==category,
        AccessGrant.revoked.is_(False), AccessGrant.ends_at>at))


async def access(db, account_id, category, *, vehicle=None, at=None):
    at=at or now()
    granted=await db.scalar(select(AccessGrant.ends_at).where(AccessGrant.account_id==account_id,
        AccessGrant.category==category, AccessGrant.revoked.is_(False), AccessGrant.starts_at<=at,
        AccessGrant.ends_at>at).order_by(AccessGrant.ends_at.desc()).limit(1))
    if granted:
        return {"active": True, "kind": "granted", "ends_at": granted, "reason": None}
    trial=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==account_id, CategoryAccess.category==category))
    if trial and trial.trial_started_at and trial.trial_started_at<=at<trial.trial_ends_at:
        end=trial.trial_ends_at
        if category in TRANSPORT:
            q=select(VehicleTrial.ends_at).where(VehicleTrial.account_id==account_id, VehicleTrial.starts_at<=at, VehicleTrial.ends_at>at)
            if vehicle is not None:
                try:key=plate_key(vehicle.plate_number)
                except HTTPException:key=None
                q=q.where(VehicleTrial.plate_key==key)
            else:
                # Only registered machines, never an unattached fingerprint, can unlock a transport trial/chat.
                q=q.join(Vehicle,Vehicle.plate_key==VehicleTrial.plate_key).join(VehicleMembership,and_(VehicleMembership.vehicle_id==Vehicle.id,
                    VehicleMembership.account_id==account_id)).where(Vehicle.is_active.is_(True))
            vehicle_end=await db.scalar(q.order_by(VehicleTrial.ends_at.desc()).limit(1))
            if not vehicle_end:
                return {"active":False,"kind":"restricted","ends_at":end,"reason":"VEHICLE_TRIAL_UNAVAILABLE"}
            end=min(end,vehicle_end)
        return {"active":True,"kind":"trial","ends_at":end,"reason":None}
    return {"active":False,"kind":"expired" if trial and trial.trial_started_at else "not_started",
            "ends_at":trial.trial_ends_at if trial else None,"reason":"SUBSCRIPTION_REQUIRED"}


async def chat_access(db, user):
    if user.role.name=="admin":return True
    for category,(_,roles) in CATEGORIES.items():
        if user.role.name in roles and (await access(db,user.id,category))["active"]:return True
    return False


async def register_vehicle(db, user, vehicle_id, category, *, at=None):
    at=at or now()
    current=await db.scalar(select(Driver).where(Driver.user_id==user.id))
    member=await db.get(VehicleMembership,(user.id,vehicle_id))
    if not member and (not current or current.vehicle_id!=vehicle_id):
        error("VEHICLE_NOT_OWNED","Машина не связана с вашим профилем")
    vehicle=await db.get(Vehicle,vehicle_id)
    if not vehicle or not vehicle.is_active:error("VEHICLE_UNAVAILABLE","Машина недоступна",422)
    key=plate_key(vehicle.plate_number);vehicle.plate_key=key
    account=await account_category(db,user.id,category,lock=True)
    if not account.trial_ends_at or account.trial_ends_at<=at:error("TRIAL_NOT_ACTIVE","Пробный период не активен",409)
    claim=await db.get(VehicleTrial,key)
    if claim:
        if claim.account_id!=user.id or claim.ends_at<=at:
            error("VEHICLE_TRIAL_ALREADY_USED","Эта машина уже использовала пробный период. Выберите подписку или обратитесь к администратору",409)
        # The original deadline never changes, including driver -> carrier transitions.
    else:
        await db.execute(insert(VehicleTrial).values(plate_key=key,account_id=user.id,vehicle_id=vehicle.id,
            starts_at=at,ends_at=account.trial_ends_at).on_conflict_do_nothing(index_elements=["plate_key"]))
        claim=await db.get(VehicleTrial,key)
        if claim.account_id!=user.id:error("VEHICLE_TRIAL_ALREADY_USED","Пробный период машины уже использован",409)
    await db.execute(insert(VehicleMembership).values(account_id=user.id,vehicle_id=vehicle.id).on_conflict_do_nothing())
    audit(db,user.id,user.id,"vehicle_trial_linked",vehicle_id=str(vehicle.id),category=category)
    return vehicle


async def activate_trial(db,user,category):
    if not await enabled(db):error("SUBSCRIPTIONS_NOT_ENABLED","Подписки пока не включены",409)
    if category not in CATEGORIES or user.role.name not in CATEGORIES[category][1]:
        error("CATEGORY_NOT_ALLOWED","Категория недоступна для этого кабинета")
    row=await account_category(db,user.id,category,lock=True)
    if row.trial_started_at:
        return await access(db,user.id,category)
    # One account/category plus persistent contact keys. No plaintext contacts in the ledger.
    identities={identity_key(x) for x in [user.username,user.email] if x}
    previous=await db.scalar(select(TrialIdentity).where(TrialIdentity.category==category,TrialIdentity.identity_key.in_(identities)))
    if previous:error("TRIAL_ALREADY_USED","Пробный период уже использован. Выберите подписку",409)
    if await grant_end(db,user.id,category):error("ACCESS_ALREADY_GRANTED","У вас уже есть действующий доступ",409)
    at=now();row.trial_started_at=at;row.trial_ends_at=at+timedelta(days=14)
    for key in identities:
        inserted=await db.scalar(insert(TrialIdentity).values(category=category,identity_key=key,account_id=user.id,started_at=at)
            .on_conflict_do_nothing().returning(TrialIdentity.identity_key))
        if inserted is None:error("TRIAL_ALREADY_USED","Пробный период уже использован",409)
    if category in TRANSPORT:
        driver=await db.scalar(select(Driver).where(Driver.user_id==user.id))
        if not driver or not driver.vehicle_id:error("VEHICLE_REQUIRED","Сначала добавьте машину в профиль",422)
        await register_vehicle(db,user,driver.vehicle_id,category,at=at)
    audit(db,user.id,user.id,"trial_started",category=category,ends_at=row.trial_ends_at.isoformat())
    await db.flush()
    return await access(db,user.id,category)


def platform_enabled_clause():
    return exists(select(SprintSetting.key).where(SprintSetting.key=="platform",SprintSetting.value["enabled"].as_boolean().is_(True)))


def transport_access_clause():
    """Correlated admission predicate shared by ranking, manual assign and accept."""
    paid=exists(select(AccessGrant.id).where(AccessGrant.account_id==Driver.user_id,
        AccessGrant.category.in_(TRANSPORT),AccessGrant.revoked.is_(False),
        AccessGrant.starts_at<=func.now(),AccessGrant.ends_at>func.now()))
    trial=exists(select(CategoryAccess.id).join(VehicleTrial,VehicleTrial.account_id==CategoryAccess.account_id).where(
        CategoryAccess.account_id==Driver.user_id,CategoryAccess.category.in_(TRANSPORT),
        CategoryAccess.trial_started_at<=func.now(),CategoryAccess.trial_ends_at>func.now(),
        VehicleTrial.plate_key==Vehicle.plate_key,VehicleTrial.starts_at<=func.now(),VehicleTrial.ends_at>func.now()))
    return or_(~platform_enabled_clause(),paid,trial)


async def resource_access(db,entity,category,resource_type,at=None):
    if not await enabled(db):return True
    at=at or now();owner=getattr(entity,"owner_user_id",None)
    if owner and (await access(db,owner,category,at=at))["active"]:return True
    return bool(await db.scalar(select(AccessGrant.id).where(AccessGrant.resource_type==resource_type,
        AccessGrant.resource_id==entity.id,AccessGrant.revoked.is_(False),AccessGrant.starts_at<=at,AccessGrant.ends_at>at).limit(1)))


def point_category(point):
    if point.point_type=="quarry":return "quarry"
    if point.point_type in {"accumulator","warehouse"}:return "accumulator"
    return "firewood"


async def seed_plans(db):
    # Serialize catalog initialization without treating QA plans as commercial drafts.
    await db.execute(select(func.pg_advisory_xact_lock(260027)))
    for category in CATEGORIES:
        amounts=[2900,8400,16200,30000] if category in {"quarry","accumulator"} else [1900,5400,10200,19200]
        for months,amount in zip([1,3,6,12],amounts):
            if await db.scalar(select(SubscriptionPlan.id).where(SubscriptionPlan.category==category, SubscriptionPlan.months==months, SubscriptionPlan.test_only.is_(False)).limit(1)):
                continue
            db.add(SubscriptionPlan(category=category,name=f"{CATEGORIES[category][0]} · {months} мес.",months=months,
                amount=None if category=="carrier" else amount,published=False,test_only=False))
    await db.flush()


def resource_access_clause(model, category, resource_type):
    """SQL equivalent of resource_access, for selection before pricing/dispatch."""
    paid=exists(select(AccessGrant.id).where(AccessGrant.account_id==model.owner_user_id,
        AccessGrant.category==category,AccessGrant.revoked.is_(False),
        AccessGrant.starts_at<=func.now(),AccessGrant.ends_at>func.now()))
    trial=exists(select(CategoryAccess.id).where(CategoryAccess.account_id==model.owner_user_id,
        CategoryAccess.category==category,CategoryAccess.trial_started_at<=func.now(),CategoryAccess.trial_ends_at>func.now()))
    preserved=exists(select(AccessGrant.id).where(AccessGrant.resource_type==resource_type,
        AccessGrant.resource_id==model.id,AccessGrant.revoked.is_(False),
        AccessGrant.starts_at<=func.now(),AccessGrant.ends_at>func.now()))
    return or_(~platform_enabled_clause(),paid,trial,preserved)


def pickup_access_clause():
    from sqlalchemy import case
    from app.models.models import Quarry
    category=case((Quarry.point_type=="quarry","quarry"),
        (Quarry.point_type.in_(["accumulator","warehouse"]),"accumulator"),else_="firewood")
    return resource_access_clause(Quarry,category,"pickup_point")
