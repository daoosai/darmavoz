from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from app.core.config import settings
from app.models.subscriptions import SubscriptionPlan,SubscriptionPayment,SubscriptionRefund,AccessGrant,SprintSetting,JourneyAttempt
from app.services import subscription_billing as b,subscriptions as s,payments as provider,journey as j
from app.services.subscription_transition import apply as transition,preview
from app.models.models import Quarry,City
from tests.test_sprint26_subscriptions import platform,create_actor,paid_case

@pytest.mark.asyncio
async def test_durable_retry_uses_same_request_key_after_session_restart(platform,session_factory,monkeypatch):
    calls=[]
    async with session_factory() as db:
        user,_=await create_actor(db,'supplier');plan=SubscriptionPlan(category='quarry',name='QA recovery',months=1,amount=10,published=True,test_only=True);db.add(plan);await db.flush()
        row=await b.create(db,user,plan.id,uuid4(),'qa@example.invalid');await db.commit();pid=row.id;metadata=row.body['metadata'];key=row.idempotence_key
    async def unavailable(method,path,body=None,key=None):calls.append((method,path,key));raise provider.ProviderError()
    monkeypatch.setattr(provider,'provider',unavailable)
    async with session_factory() as db:await b.process(db,'payment',pid)
    async with session_factory() as db:
        row=await db.get(SubscriptionPayment,pid);assert row.status=='unknown' and row.attempts==1 and row.idempotence_key==key
    result={'id':uuid4().hex,'status':'succeeded','test':True,'recipient':{'account_id':settings.YOOKASSA_SHOP_ID},'metadata':metadata,'amount':{'value':'10.00','currency':'RUB'}}
    async def succeed(method,path,body=None,key=None):calls.append((method,path,key));return result
    monkeypatch.setattr(provider,'provider',succeed)
    async with session_factory() as db:await b.process(db,'payment',pid)
    async with session_factory() as db:
        row=await db.get(SubscriptionPayment,pid);assert row.status=='succeeded'
        assert len((await db.scalars(select(AccessGrant).where(AccessGrant.source_key==f'payment:{pid}'))).all())==1
        assert await b.handle_webhook(db,'payment.succeeded',result)
        assert await b.handle_webhook(db,'payment.succeeded',result)
    assert calls[:2]==[('POST','/payments',key)]*2
    assert all(x[0]=='GET' for x in calls[2:])

@pytest.mark.asyncio
async def test_expired_idempotency_window_never_creates_a_new_payment(platform,session_factory,monkeypatch):
    async def forbidden(*args,**kwargs):raise AssertionError('No POST after provider idempotency retention window')
    monkeypatch.setattr(provider,'provider',forbidden)
    async with session_factory() as db:
        user,_=await create_actor(db,'supplier');plan=SubscriptionPlan(category='quarry',name='QA expired request',months=1,amount=10,published=True,test_only=True);db.add(plan);await db.flush()
        row=await b.create(db,user,plan.id,uuid4(),'qa@example.invalid');row.created_at=s.now()-timedelta(hours=24);await db.commit();pid=row.id
    async with session_factory() as db:await b.process(db,'payment',pid)
    async with session_factory() as db:
        row=await db.get(SubscriptionPayment,pid);assert row.status=='manual_review' and row.last_error=='idempotency_window_expired'

@pytest.mark.asyncio
async def test_external_refund_import_and_explicit_access_decision(platform,session_factory,monkeypatch):
    async with session_factory() as db:
        user,_,payment,_=await paid_case(db);admin,_=await create_actor(db,'admin');await db.commit();pid=payment.id
        result={'id':uuid4().hex,'payment_id':payment.provider_id,'status':'succeeded','amount':{'value':'3.00','currency':'RUB'}}
        async def get_only(method,path,*args):assert method=='GET';return result
        monkeypatch.setattr(provider,'provider',get_only)
        for _ in range(2):assert await b.handle_webhook(db,'refund.succeeded',result)
        rows=(await db.scalars(select(SubscriptionRefund).where(SubscriptionRefund.payment_id==pid))).all();assert len(rows)==1
        refund=rows[0];assert refund.actor_id is None and refund.access_review_required
        grant=await db.scalar(select(AccessGrant).where(AccessGrant.source_key==f'payment:{pid}'));assert not grant.revoked
        await b.decide_refund_access(db,admin,refund.id,{'action':'keep'},'QA explicit review');await db.commit()
        assert refund.adjustment_applied and not refund.access_review_required and not grant.revoked
        await b.decide_refund_access(db,admin,refund.id,{'action':'keep'},'QA replay')
        with pytest.raises(HTTPException):await b.decide_refund_access(db,admin,refund.id,{'action':'revoke'},'QA contradictory replay')

@pytest.mark.asyncio
async def test_late_binding_of_journey_to_already_succeeded_payment(platform,session_factory):
    async with session_factory() as db:
        setting=await db.get(SprintSetting,'platform');setting.value={**setting.value,'journey_enabled':True};await db.commit()
        user,_,payment,_=await paid_case(db)
        sid,vid,aid=uuid4(),uuid4(),uuid4()
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='subscription',event='subscription_payment_created',source='server',actor=('user',user.id),payment_id=payment.id,state='pending');await db.commit()
        await j.maintenance(db);await db.commit()
        attempt=await db.get(JourneyAttempt,aid);assert attempt.state=='succeeded' and attempt.stage=='subscription_payment_succeeded'

@pytest.mark.asyncio
async def test_transition_preserves_dates_and_ownerless_scope_idempotently(platform,session_factory):
    async with session_factory() as db:
        owner,_=await create_actor(db,'supplier');admin,_=await create_actor(db,'admin');city=await db.scalar(select(City).where(City.code=='tyumen'));start=s.now()-timedelta(days=3);end=s.now()+timedelta(days=4)
        one=Quarry(name='QA legacy owner',address='QA',point_type='quarry',city_id=city.id,owner_user_id=owner.id,placement_started_at=start,trial_ends_at=end,placement_ends_at=end,is_active=True)
        two=Quarry(name='QA legacy unowned',address='QA',point_type='accumulator',city_id=city.id,placement_started_at=start,placement_ends_at=end,is_active=True)
        db.add_all([one,two]);await db.commit()
        a=await transition(db,admin.id);await db.commit();second=await transition(db,admin.id);await db.commit()
        assert a['copied_grants']>=2 and second['copied_grants']==0
        grants=(await db.scalars(select(AccessGrant).where(AccessGrant.resource_id.in_([one.id,two.id])))).all();assert len(grants)==2
        assert all(x.starts_at==start and x.ends_at==end for x in grants)
        assert next(x for x in grants if x.resource_id==two.id).account_id is None
        from app.models.subscriptions import CategoryAccess
        access=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==owner.id,CategoryAccess.category=='quarry'))
        assert access.trial_started_at==start and access.trial_ends_at==end


@pytest.mark.asyncio
@pytest.mark.parametrize('amount,allowed', [('0.40',False),('9.50',False),('1.00',True),('9.00',True),('10.00',True)])
async def test_partial_refund_respects_provider_minimum_and_remainder(platform,session_factory,amount,allowed):
    async with session_factory() as db:
        _,_,payment,_=await paid_case(db);admin,_=await create_actor(db,'admin');await db.commit()
        if not allowed:
            with pytest.raises(HTTPException) as exc:
                await b.refund(db,admin,payment.id,Decimal(amount),'QA provider technical limits',uuid4())
            assert exc.value.status_code==422 and exc.value.detail['code']=='REFUND_PROVIDER_LIMITS'
            assert not (await db.scalars(select(SubscriptionRefund).where(SubscriptionRefund.payment_id==payment.id))).all()
        else:
            row=await b.refund(db,admin,payment.id,Decimal(amount),'QA provider technical limits',uuid4())
            await db.flush()
            assert row.body['amount']=={'value':amount,'currency':'RUB'}
            assert row.body['receipt']['items'][0]['amount']['value']==amount

@pytest.mark.asyncio
async def test_partial_refund_limits_use_remaining_balance(platform,session_factory):
    async with session_factory() as db:
        _,_,payment,_=await paid_case(db);admin,_=await create_actor(db,'admin');await db.commit()
        first=await b.refund(db,admin,payment.id,Decimal('1'),'QA initial partial refund',uuid4())
        await b.apply_refund(db,first,payment,{'id':uuid4().hex,'payment_id':payment.provider_id,'amount':{'value':'1.00','currency':'RUB'},'status':'succeeded'})
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await b.refund(db,admin,payment.id,Decimal('8.50'),'QA invalid remainder',uuid4())
        assert exc.value.detail['code']=='REFUND_PROVIDER_LIMITS'
        final=await b.refund(db,admin,payment.id,Decimal('9'),'QA remaining full refund',uuid4())
        await db.flush();assert final.amount==Decimal('9')
