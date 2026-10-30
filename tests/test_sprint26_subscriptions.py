"""S26 disposable-database access/billing tests; no real money or external messages."""
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, delete
from app.core.config import settings
from app.models.models import User, Driver, Vehicle
from app.models.subscriptions import (SprintSetting, SubscriptionPlan, CategoryAccess, AccessGrant, VehicleTrial,
    VehicleMembership, SubscriptionPayment, SubscriptionRefund)
from app.services import subscriptions as s, subscription_billing as b
from tests.test_sprint24_api import create_actor as base_actor
from app.models.models import Role

async def create_actor(db, name):
    user, headers = await base_actor(db, name)
    user.role = await db.get(Role, user.role_id)
    return user, headers

@pytest_asyncio.fixture
async def platform(session_factory,monkeypatch):
    for k,v in {"PAYMENTS_ENABLED":True,"PAYMENT_TEST_MODE":True,"YOOKASSA_SHOP_ID":"s26-qa",
        "YOOKASSA_SECRET_KEY":"fake-not-money","YOOKASSA_API_BASE_URL":"https://example.invalid/v3",
        "PAYMENT_RETURN_URL":"https://example.invalid/app","PAYMENT_RECEIPTS_ENABLED":True,
        "PAYMENT_RECEIPT_VAT_CODE":1}.items():monkeypatch.setattr(settings,k,v)
    async with session_factory() as db:
        await db.execute(delete(SprintSetting).where(SprintSetting.key=="platform"))
        db.add(SprintSetting(key="platform",value={"enabled":True,"direct_orders":True}));await db.commit()
    yield
    async with session_factory() as db:
        await db.execute(delete(SprintSetting).where(SprintSetting.key=="platform"));await db.commit()

@pytest.mark.parametrize("raw",["А123ВС72","a123bc 72","А-123-ВС-72 RUS","Ａ１２３ＢＣ７２"])
def test_plate_normalization(raw):
    assert s.normalize_plate(raw)=="A123BC72"
    assert s.plate_key(raw)==s.plate_key("A123BC72")

@pytest.mark.parametrize("value",["","invalid","А123ВС","A123BC72<script>"])
def test_invalid_plate_requires_admin(value):
    with pytest.raises(HTTPException) as e:s.normalize_plate(value)
    assert e.value.status_code==422

@pytest.mark.parametrize("at,months,expected",[(datetime(2024,1,31,tzinfo=UTC),1,(2024,2,29)),(datetime(2025,1,31,tzinfo=UTC),1,(2025,2,28)),(datetime(2024,2,29,tzinfo=UTC),12,(2025,2,28))])
def test_calendar_months(at,months,expected):
    result=s.add_months(at,months);assert (result.year,result.month,result.day)==expected

@pytest.mark.asyncio
async def test_trial_boundaries_and_re_registration(platform,session_factory):
    async with session_factory() as db:
        user,_=await create_actor(db,"supplier");username=user.username
        result=await s.activate_trial(db,user,"quarry");await db.commit()
        assert result["kind"]=="trial"
        row=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==user.id))
        assert row.trial_ends_at-row.trial_started_at==timedelta(days=14)
        assert (await s.access(db,user.id,"quarry",at=row.trial_ends_at-timedelta(microseconds=1)))["active"]
        assert not (await s.access(db,user.id,"quarry",at=row.trial_ends_at))["active"]
        repeat=await s.activate_trial(db,user,"quarry");assert repeat["ends_at"]==row.trial_ends_at
        user.username="deleted-"+uuid4().hex;await db.commit()
        new,_=await create_actor(db,"supplier");new.username=username;await db.flush()
        with pytest.raises(HTTPException) as e:await s.activate_trial(db,new,"quarry")
        assert e.value.detail["code"]=="TRIAL_ALREADY_USED"
        await db.rollback()

@pytest.mark.asyncio
async def test_mixed_fleet_shared_driver_carrier_deadline(platform,session_factory):
    async with session_factory() as db:
        user,_=await create_actor(db,"driver");driver=user.driver_profile;driver.vehicle.plate_number="А123ВС72"
        # Unique plate across independent tests.
        driver.vehicle.plate_number=f"A{100+int(uuid4().hex[:3],16)%900}BC777"
        await db.flush();first=await s.activate_trial(db,user,"driver");await db.commit()
        carrier=await s.activate_trial(db,user,"carrier");await db.commit()
        assert carrier["ends_at"]==first["ends_at"]
        other,_=await create_actor(db,"driver");other.driver_profile.vehicle.plate_number=driver.vehicle.plate_number;await db.flush()
        with pytest.raises(HTTPException) as e:await s.activate_trial(db,other,"driver")
        assert e.value.detail["code"]=="VEHICLE_TRIAL_ALREADY_USED";await db.rollback()

@pytest.mark.asyncio
async def test_mixed_fleet_used_vehicle_is_not_unlocked(platform,session_factory):
    async with session_factory() as db:
        user,_=await create_actor(db,"driver")
        user.driver_profile.vehicle.plate_number=f"B{100+int(uuid4().hex[:3],16)%900}CC199";await db.flush()
        await s.activate_trial(db,user,"driver")
        used=Vehicle(title="Previously used",plate_number=f"C{100+int(uuid4().hex[:3],16)%900}AB178")
        db.add(used);await db.flush();db.add(VehicleMembership(account_id=user.id,vehicle_id=used.id))
        db.add(VehicleTrial(plate_key=s.plate_key(used.plate_number),account_id=uuid4(),vehicle_id=used.id,
            starts_at=s.now()-timedelta(days=30),ends_at=s.now()-timedelta(days=16)));await db.commit()
        assert (await s.access(db,user.id,"driver",vehicle=user.driver_profile.vehicle))["active"]
        assert not (await s.access(db,user.id,"driver",vehicle=used))["active"]
        db.add(AccessGrant(account_id=user.id,category="driver",source="admin",source_key=uuid4().hex,
            starts_at=s.now()-timedelta(seconds=1),ends_at=s.now()+timedelta(days=1)));await db.commit()
        assert (await s.access(db,user.id,"driver",vehicle=used))["active"]

async def paid_case(db):
    user,_=await create_actor(db,"supplier")
    plan=SubscriptionPlan(category="quarry",name="QA only",months=1,amount=Decimal("10"),published=True,test_only=True)
    db.add(plan);await db.flush()
    payment=await b.create(db,user,plan.id,uuid4(),"qa@example.invalid");await db.commit()
    data={"id":uuid4().hex,"status":"succeeded","amount":{"value":"10.00","currency":"RUB"},
        "recipient":{"account_id":settings.YOOKASSA_SHOP_ID},"test":True,"metadata":payment.body["metadata"]}
    await b.apply_payment(db,payment,data);await db.commit();return user,plan,payment,data

@pytest.mark.asyncio
async def test_payment_replay_and_provider_validation(platform,session_factory):
    async with session_factory() as db:
        user,plan,payment,data=await paid_case(db)
        await b.apply_payment(db,payment,data);await db.commit()
        assert len((await db.scalars(select(AccessGrant).where(AccessGrant.source_key==f"payment:{payment.id}"))).all())==1
        replay=await b.create(db,user,plan.id,payment.request_id,"qa@example.invalid");assert replay.id==payment.id
        await b.apply_payment(db,payment,{**data,"amount":{"value":"0.01","currency":"RUB"}})
        assert payment.last_error=="provider_mismatch";await db.rollback()

@pytest.mark.asyncio
async def test_refund_adjusts_only_source_grant(platform,session_factory):
    async with session_factory() as db:
        user,plan,payment,_=await paid_case(db);admin,_=await create_actor(db,"admin")
        other=AccessGrant(account_id=user.id,category="quarry",source="legacy",source_key=uuid4().hex,
            starts_at=s.now()-timedelta(days=1),ends_at=s.now()+timedelta(days=3));db.add(other);await db.commit()
        request_id=uuid4();refund=await b.refund(db,admin,payment.id,Decimal("3"),"QA partial decision",request_id,{"action":"revoke"});await db.commit()
        result={"id":uuid4().hex,"status":"succeeded","payment_id":payment.provider_id,"amount":{"value":"3.00","currency":"RUB"}}
        await b.apply_refund(db,refund,payment,result);await db.commit()
        await b.apply_refund(db,refund,payment,result);await db.commit()
        own=await db.scalar(select(AccessGrant).where(AccessGrant.source_key==f"payment:{payment.id}"))
        assert own.revoked and not other.revoked and refund.adjustment_applied
        assert (await s.access(db,user.id,"quarry"))["active"]
        assert (await b.refund(db,admin,payment.id,Decimal("3"),"QA partial decision",request_id,{"action":"revoke"})).id==refund.id
        assert (await b.balances(db,payment))["refunded_amount"]=="3.00"

@pytest.mark.asyncio
async def test_refund_without_commercial_decision_requires_review(platform,session_factory):
    async with session_factory() as db:
        user,_,payment,_=await paid_case(db);admin,_=await create_actor(db,"admin")
        refund=await b.refund(db,admin,payment.id,10,"No policy invented",uuid4());await db.commit()
        await b.apply_refund(db,refund,payment,{"id":uuid4().hex,"status":"succeeded","payment_id":payment.provider_id,"amount":{"value":"10.00","currency":"RUB"}});await db.commit()
        assert refund.access_review_required and not refund.adjustment_applied
        grant=await db.scalar(select(AccessGrant).where(AccessGrant.source_key==f"payment:{payment.id}"))
        assert not grant.revoked

@pytest.mark.asyncio
async def test_transport_access_predicate_runs_on_database(platform,session_factory):
    async with session_factory() as db:
        user,_=await create_actor(db,"driver");driver=user.driver_profile
        driver.vehicle.plate_number=f"E{100+int(uuid4().hex[:3],16)%900}BC116";await db.flush()
        stmt=select(Driver.id).join(Driver.vehicle).where(Driver.id==driver.id,s.transport_access_clause())
        assert await db.scalar(stmt) is None
        await s.activate_trial(db,user,"driver");await db.commit()
        assert await db.scalar(stmt)==driver.id

@pytest.mark.asyncio
async def test_api_roles_and_draft_plans(platform,client,session_factory,admin_token):
    async with session_factory() as db:
        user,headers=await create_actor(db,"supplier");await db.commit()
    assert (await client.get("/api/v1/subscriptions/me",headers=headers)).status_code==200
    assert (await client.get("/api/v1/subscriptions/admin/settings",headers=headers)).status_code==403
    response=await client.post("/api/v1/subscriptions/trial",headers=headers,json={"category":"water"})
    assert response.status_code==403
    response=await client.get("/api/v1/subscriptions/admin/plans",headers={"Authorization":"Bearer "+admin_token})
    assert response.status_code==200
    carrier=[x for x in response.json() if x["category"]=="carrier"]
    assert carrier and all(x["amount"] is None and not x["published"] for x in carrier)
    visible=(await client.get("/api/v1/subscriptions/plans",headers=headers)).json()
    draft_ids={x["id"] for x in response.json() if not x["published"]}
    assert not any(x["id"] in draft_ids for x in visible)

@pytest.mark.asyncio
async def test_concurrent_claim_of_same_plate_has_one_trial_owner(platform,session_factory):
    import asyncio
    async with session_factory() as db:
        one,_=await create_actor(db,'driver');two,_=await create_actor(db,'driver')
        one.driver_profile.vehicle.plate_number='А613ВС116';two.driver_profile.vehicle.plate_number='А613ВС116';await db.commit()
    async def claim(user):
        async with session_factory() as db:
            try:
                result=await s.activate_trial(db,user,'driver');await db.commit();return result['active']
            except HTTPException as exc:
                await db.rollback();assert exc.detail['code']=='VEHICLE_TRIAL_ALREADY_USED';return False
    assert sorted(await asyncio.gather(claim(one),claim(two)))==[False,True]

@pytest.mark.asyncio
async def test_concurrent_purchase_returns_one_durable_attempt(platform,session_factory):
    import asyncio
    async with session_factory() as db:
        user,_=await create_actor(db,'supplier');plan=SubscriptionPlan(category='quarry',name='QA concurrency',months=1,amount=1,published=True,test_only=True);db.add(plan);await db.commit();plan_id=plan.id
    async def create():
        async with session_factory() as db:
            row=await b.create(db,user,plan_id,uuid4(),'qa@example.invalid');await db.commit();return row.id
    ids=await asyncio.gather(create(),create());assert ids[0]==ids[1]


@pytest.mark.asyncio
async def test_transport_switch_and_new_car_cannot_extend_account_trial(platform,session_factory):
    async with session_factory() as db:
        user,_=await create_actor(db,'driver');user.driver_profile.vehicle.plate_number='Х'+str(100+int(uuid4().hex[:3],16)%900)+'АВ196';await db.flush()
        await s.activate_trial(db,user,'driver');await db.commit()
        original=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==user.id,CategoryAccess.category=='driver'))
        original.trial_started_at-=timedelta(days=5);original.trial_ends_at-=timedelta(days=5);await db.commit();deadline=original.trial_ends_at
        await s.activate_trial(db,user,'carrier');await db.commit()
        carrier=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==user.id,CategoryAccess.category=='carrier'))
        assert carrier.trial_ends_at==deadline and carrier.trial_started_at==original.trial_started_at
        car=Vehicle(title='QA added later',plate_number='К'+str(100+int(uuid4().hex[:3],16)%900)+'СМ193',is_active=True);db.add(car);await db.flush()
        db.add(VehicleMembership(account_id=user.id,vehicle_id=car.id));await db.flush()
        await s.register_vehicle(db,user,car.id,'carrier');await db.commit()
        claim=await db.get(VehicleTrial,s.plate_key(car.plate_number));assert claim.ends_at==deadline
        original.trial_ends_at=s.now()-timedelta(seconds=1);carrier.trial_ends_at=original.trial_ends_at;await db.commit()
        assert not (await s.access(db,user.id,'carrier',vehicle=car))['active']

@pytest.mark.asyncio
async def test_expired_driver_trial_does_not_restart_as_carrier(platform,session_factory):
    async with session_factory() as db:
        user,_=await create_actor(db,'driver');user.driver_profile.vehicle.plate_number='Т'+str(100+int(uuid4().hex[:3],16)%900)+'НР197';await db.flush()
        await s.activate_trial(db,user,'driver');await db.commit()
        original=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==user.id,CategoryAccess.category=='driver'))
        original.trial_started_at=s.now()-timedelta(days=15);original.trial_ends_at=s.now()-timedelta(days=1);await db.commit()
        result=await s.activate_trial(db,user,'carrier');await db.commit()
        assert not result['active'] and result['kind']=='expired' and result['ends_at']==original.trial_ends_at
