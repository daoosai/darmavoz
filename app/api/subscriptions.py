from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from app.db.database import get_db
from app.models.models import User, Driver, Vehicle
from app.models.subscriptions import (SprintSetting, SubscriptionPlan, SubscriptionPayment,
    SubscriptionRefund, AccessGrant, SubscriptionAudit, VehicleMembership)
from app.security.auth import get_current_user, get_current_admin_user, get_current_order_actor
from app.services import subscriptions as service, subscription_billing as billing

router=APIRouter(prefix="/api/v1/subscriptions",tags=["subscriptions"])

class Input(BaseModel):
    model_config=ConfigDict(extra="forbid",str_strip_whitespace=True)

class TrialInput(Input):
    category: str

class VehicleInput(TrialInput):
    vehicle_id: UUID

class PayInput(Input):
    plan_id: UUID
    request_id: UUID
    email: str | None = Field(default=None,max_length=254)
    @field_validator("email")
    @classmethod
    def valid_email(cls,value):
        if value and ("@" not in value or "." not in value.split("@")[-1]):raise ValueError("Укажите почту для чека")
        return value

class PlanInput(Input):
    category: str
    name: str = Field(min_length=3,max_length=160)
    months: Literal[1,3,6,12]
    amount: Decimal | None = Field(default=None,gt=0,max_digits=14,decimal_places=2)
    published: bool = False
    test_only: bool = False
    @model_validator(mode="after")
    def valid(self):
        if self.category not in service.CATEGORIES:raise ValueError("Неизвестная категория")
        if self.published and self.amount is None:raise ValueError("Нельзя опубликовать тариф без цены")
        return self

class GrantInput(TrialInput):
    account_id: UUID
    starts_at: datetime
    ends_at: datetime
    reason: str = Field(min_length=3,max_length=500)
    @model_validator(mode="after")
    def valid(self):
        if not self.starts_at.tzinfo or not self.ends_at.tzinfo or self.ends_at<=self.starts_at:raise ValueError("Проверьте период")
        return self

class RefundInput(Input):
    amount: Decimal = Field(gt=0,max_digits=14,decimal_places=2)
    reason: str = Field(min_length=3,max_length=500)
    request_id: UUID
    access_adjustment: dict | None = None

class SettingsInput(Input):
    enabled: bool | None = None
    direct_orders: bool | None = None
    water_paid_only: bool | None = None
    chat_enabled: bool | None = None
    journey_enabled: bool | None = None
    login_idle_minutes: int | None = Field(default=None,ge=1,le=1440)
    order_idle_minutes: int | None = Field(default=None,ge=1,le=10080)
    payment_idle_minutes: int | None = Field(default=None,ge=1,le=10080)
    event_days: int | None = Field(default=None,ge=1,le=3650)
    contact_days: int | None = Field(default=None,ge=1,le=3650)
    input_group_minutes: int | None = Field(default=None,ge=1,le=60)
    dispatch_retry_seconds: int | None = Field(default=None,ge=60,le=3600)
    owner_id: UUID | None = None
    notify_push: bool | None = None
    notify_inapp: bool | None = None
    notify_abandoned: bool | None = None
    notify_events: list[Literal["technical_error","provider_rejected","auth_failed","order_failed","user_cancelled"]] | None = None
    chat_rules: str | None = Field(default=None,max_length=4000)


def plan_out(row):
    return {"id":row.id,"category":row.category,"name":row.name,"months":row.months,
        "amount":str(row.amount) if row.amount is not None else None,"published":row.published,"test_only":row.test_only,"revision":row.revision}


def refund_out(row):
    return {"id":row.id,"payment_id":row.payment_id,"amount":str(row.amount),"reason":row.reason,"status":row.status,
        "created_at":row.created_at,"access_adjustment":row.access_adjustment,"adjustment_applied":row.adjustment_applied,
        "access_review_required":row.access_review_required,"last_error":row.last_error,"request_id":row.request_id}


async def payment_out(db,row):
    return {"id":row.id,"account_id":row.account_id,"plan_id":row.plan_id,"request_id":row.request_id,"category":row.category,"months":row.months,"amount":str(row.amount),
        "status":row.status,"confirmation_url":row.confirmation_url if row.status in billing.ACTIVE else None,
        "created_at":row.created_at,"paid_at":row.paid_at,"last_error":row.last_error,
        **await billing.balances(db,row),"refunds":[refund_out(x) for x in (await db.scalars(select(SubscriptionRefund).where(SubscriptionRefund.payment_id==row.id).order_by(SubscriptionRefund.created_at.desc()))).all()]}


@router.get("/features")
async def features(db=Depends(get_db)):
    cfg=await service.config(db)
    return {k:cfg[k] for k in ["enabled","direct_orders","water_paid_only","chat_enabled","journey_enabled"]}


@router.get("/plans")
async def plans(actor=Depends(get_current_order_actor),db=Depends(get_db)):
    if not actor.user:return []
    user=actor.user
    from app.core.config import settings
    roles={c for c,(_,allowed) in service.CATEGORIES.items() if user.role.name in allowed}
    query=select(SubscriptionPlan).where(SubscriptionPlan.category.in_(roles),SubscriptionPlan.published.is_(True),SubscriptionPlan.amount.is_not(None))
    if not settings.PAYMENT_TEST_MODE:query=query.where(SubscriptionPlan.test_only.is_(False))
    return [plan_out(x) for x in (await db.scalars(query.order_by(SubscriptionPlan.category,SubscriptionPlan.months))).all()]


@router.get("/me")
async def me(actor=Depends(get_current_order_actor),db=Depends(get_db)):
    if not actor.user:return {"enabled":await service.enabled(db),"categories":[],"can_chat":False,"vehicles":[]}
    user=actor.user
    cats=[]
    for category,(label,roles) in service.CATEGORIES.items():
        if user.role.name in roles:cats.append({"category":category,"label":label,**await service.access(db,user.id,category)})
    # Preserve the existing current vehicle as a fleet membership; no arbitrary vehicle claims.
    driver=await db.scalar(select(Driver).where(Driver.user_id==user.id))
    vehicles=(await db.scalars(select(Vehicle).join(VehicleMembership,VehicleMembership.vehicle_id==Vehicle.id).where(VehicleMembership.account_id==user.id))).all()
    if driver and driver.vehicle_id and all(x.id!=driver.vehicle_id for x in vehicles):
        vehicle=await db.get(Vehicle,driver.vehicle_id)
        if vehicle:vehicles.append(vehicle)
    current_vehicle=await db.get(Vehicle,driver.vehicle_id) if driver and driver.vehicle_id else None
    transport_access=bool(current_vehicle and any([(await service.access(db,user.id,c,vehicle=current_vehicle))["active"] for c in service.TRANSPORT]))
    return {"enabled":await service.enabled(db),"categories":cats,"can_chat":await service.chat_access(db,user),
        "transport_access":transport_access,"current_vehicle_id":current_vehicle.id if current_vehicle else None,
        "vehicles":[{"id":v.id,"plate_number":v.plate_number,"title":v.title,
                     "driver":await service.access(db,user.id,"driver",vehicle=v),"carrier":await service.access(db,user.id,"carrier",vehicle=v)} for v in vehicles]}


@router.post("/trial")
async def trial(payload:TrialInput,user=Depends(get_current_user),db=Depends(get_db)):
    result=await service.activate_trial(db,user,payload.category);await db.commit();return result


@router.post("/trial/vehicles")
async def vehicle_trial(payload:VehicleInput,user=Depends(get_current_user),db=Depends(get_db)):
    if payload.category not in service.TRANSPORT or user.role.name!="driver":service.error("CATEGORY_NOT_ALLOWED","Категория недоступна")
    vehicle=await service.register_vehicle(db,user,payload.vehicle_id,payload.category);await db.commit()
    return await service.access(db,user.id,payload.category,vehicle=vehicle)


@router.post("/payments",status_code=202)
async def pay(payload:PayInput,user=Depends(get_current_user),db=Depends(get_db)):
    row=await billing.create(db,user,payload.plan_id,payload.request_id,payload.email)
    from app.services.journey import mark_payment
    mark_payment(row.id)
    await db.commit();return await payment_out(db,row)


@router.get("/payments")
async def my_payments(actor=Depends(get_current_order_actor),db=Depends(get_db)):
    if not actor.user:return []
    user=actor.user
    rows=(await db.scalars(select(SubscriptionPayment).where(SubscriptionPayment.account_id==user.id).order_by(SubscriptionPayment.created_at.desc()).limit(100))).all()
    return [await payment_out(db,x) for x in rows]


@router.get("/payments/{payment_id}")
async def payment(payment_id:UUID,user=Depends(get_current_user),db=Depends(get_db)):
    row=await db.get(SubscriptionPayment,payment_id)
    if not row or (row.account_id!=user.id and user.role.name!="admin"):service.error("PAYMENT_NOT_FOUND","Платеж не найден",404)
    return await payment_out(db,row)


@router.get("/admin/settings")
async def get_settings(user=Depends(get_current_admin_user),db=Depends(get_db)):
    return await service.config(db)


@router.patch("/admin/settings")
async def set_settings(payload:SettingsInput,user=Depends(get_current_admin_user),db=Depends(get_db)):
    changes=payload.model_dump(exclude_unset=True,mode="json")
    if any(v is None for k,v in changes.items() if k!="owner_id"):service.error("INVALID_SETTING","Значение настройки не может быть пустым",422)
    if changes.get("owner_id"):
        owner=await db.get(User,UUID(changes["owner_id"]))
        if not owner or not owner.is_active or owner.is_deleted:service.error("OWNER_UNAVAILABLE","Получатель не найден",422)
        from app.models.models import Role
        role=await db.get(Role,owner.role_id)
        if role.name!="admin":service.error("OWNER_NOT_ADMIN","Получателем должен быть администратор",422)
    row=await db.scalar(select(SprintSetting).where(SprintSetting.key=="platform").with_for_update())
    if not row:row=SprintSetting(key="platform",value={});db.add(row)
    row.value={**row.value,**changes};service.audit(db,user.id,None,"settings_updated",keys=list(changes))
    await db.commit();return await service.config(db)


@router.get("/admin/plans")
async def admin_plans(user=Depends(get_current_admin_user),db=Depends(get_db)):
    await service.seed_plans(db);await db.commit()
    return [plan_out(x) for x in (await db.scalars(select(SubscriptionPlan).order_by(SubscriptionPlan.category,SubscriptionPlan.months))).all()]


@router.post("/admin/plans",status_code=201)
async def add_plan(payload:PlanInput,user=Depends(get_current_admin_user),db=Depends(get_db)):
    from app.core.config import settings
    if payload.test_only and not settings.PAYMENT_TEST_MODE:service.error("TEST_PLAN_FORBIDDEN","Тестовый тариф доступен только в тестовом магазине",409)
    row=SubscriptionPlan(**payload.model_dump());db.add(row);await db.flush()
    service.audit(db,user.id,None,"plan_created",plan_id=str(row.id),category=row.category)
    await db.commit();return plan_out(row)


@router.post("/admin/grants",status_code=201)
async def grant(payload:GrantInput,user=Depends(get_current_admin_user),db=Depends(get_db)):
    target=await db.get(User,payload.account_id)
    if not target or target.is_deleted or not target.is_active:service.error("ACCOUNT_UNAVAILABLE","Аккаунт недоступен",422)
    if payload.category not in service.CATEGORIES:service.error("UNKNOWN_CATEGORY","Неизвестная категория",422)
    await service.account_category(db,target.id,payload.category,lock=True)
    row=AccessGrant(account_id=target.id,category=payload.category,source="admin",source_key=f"admin:{uuid4()}",starts_at=payload.starts_at,ends_at=payload.ends_at)
    db.add(row);service.audit(db,user.id,target.id,"manual_grant",category=payload.category,reason=payload.reason,ends_at=payload.ends_at.isoformat())
    await db.commit();return {"id":row.id}


@router.get("/admin/payments")
async def all_payments(status:str|None=None,page:int=Query(1,ge=1),user=Depends(get_current_admin_user),db=Depends(get_db)):
    query=select(SubscriptionPayment)
    if status:query=query.where(SubscriptionPayment.status==status)
    rows=(await db.scalars(query.order_by(SubscriptionPayment.created_at.desc()).offset((page-1)*30).limit(30))).all()
    return [await payment_out(db,x) for x in rows]


@router.post("/admin/payments/{payment_id}/refunds",status_code=202)
async def make_refund(payment_id:UUID,payload:RefundInput,user=Depends(get_current_admin_user),db=Depends(get_db)):
    row=await billing.refund(db,user,payment_id,payload.amount,payload.reason,payload.request_id,payload.access_adjustment)
    await db.commit();return refund_out(row)


@router.get("/admin/audit")
async def access_audit(account_id:UUID|None=None,user=Depends(get_current_admin_user),db=Depends(get_db)):
    q=select(SubscriptionAudit)
    if account_id:q=q.where(SubscriptionAudit.account_id==account_id)
    return [{"id":x.id,"actor_id":x.actor_id,"account_id":x.account_id,"action":x.action,"details":x.details,"created_at":x.created_at} for x in (await db.scalars(q.order_by(SubscriptionAudit.created_at.desc()).limit(200))).all()]


class AccessDecisionInput(Input):
    access_adjustment: dict
    reason: str = Field(min_length=3,max_length=500)


@router.post("/admin/refunds/{refund_id}/access-decision")
async def refund_access_decision(refund_id:UUID,payload:AccessDecisionInput,user=Depends(get_current_admin_user),db=Depends(get_db)):
    row=await billing.decide_refund_access(db,user,refund_id,payload.access_adjustment,payload.reason)
    await db.commit();return refund_out(row)


@router.get('/admin/transition')
async def transition_preview(user=Depends(get_current_admin_user),db=Depends(get_db)):
    from app.services.subscription_transition import preview
    return await preview(db)


@router.post('/admin/transition')
async def transition_apply(user=Depends(get_current_admin_user),db=Depends(get_db)):
    from app.services.subscription_transition import apply
    result=await apply(db,user.id);await db.commit();return result


@router.get("/admin/accounts")
async def accounts(q:str=Query("",max_length=120),user=Depends(get_current_admin_user),db=Depends(get_db)):
    from app.models.models import Role
    from sqlalchemy import or_
    query=select(User,Role.name).join(Role,Role.id==User.role_id).where(User.is_active.is_(True),User.is_deleted.is_(False))
    if q:
        try:key=UUID(q)
        except ValueError:key=None
        query=query.where(or_(User.display_name.ilike(f"%{q}%"),User.id==key))
    return [{"id":x.id,"name":x.display_name or "Аккаунт", "role":role} for x,role in (await db.execute(query.order_by(User.display_name,User.id).limit(100))).all()]


@router.get("/admin/vehicle-trial")
async def vehicle_history(plate_number:str=Query(max_length=30),user=Depends(get_current_admin_user),db=Depends(get_db)):
    from app.models.subscriptions import VehicleTrial
    normalized=service.normalize_plate(plate_number)
    row=await db.get(VehicleTrial,service.plate_key(normalized))
    service.audit(db,user.id,None,"vehicle_trial_reviewed",found=bool(row));await db.commit()
    return {"found":bool(row),"account_id":row.account_id if row else None,"vehicle_id":row.vehicle_id if row else None,
        "starts_at":row.starts_at if row else None,"ends_at":row.ends_at if row else None}
