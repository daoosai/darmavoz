from datetime import timedelta
from uuid import uuid4
import anyio
import pytest
from sqlalchemy import select,func
from app.models.models import PushDelivery,UserNotification,Driver,Vehicle
from app.models.subscriptions import SprintSetting,JourneyAttempt,JourneySession,JourneyEvent,JourneyIncident,VehicleMembership
from app.services import journey as j,subscriptions as s
from tests.test_sprint26_subscriptions import platform,create_actor

@pytest.mark.asyncio
async def test_anonymous_failed_login_is_visible_without_account_and_owner_alert_is_once(platform,client,session_factory):
    async with session_factory() as db:
        owner,_=await create_actor(db,'admin');row=await db.get(SprintSetting,'platform')
        row.value={**row.value,'journey_enabled':True,'owner_id':str(owner.id),'notify_inapp':True,'notify_push':True};await db.commit();owner_id=owner.id
    sid,vid,aid=uuid4(),uuid4(),uuid4()
    headers={'X-Visitor-Id':str(vid),'X-Session-Id':str(sid),'X-Attempt-Id':str(aid),'X-Attempt-Kind':'auth'}
    response=await client.post('/api/v1/auth/login',headers=headers,data={'username':'+79990000005','password':'NEVER_STORE_THIS_PASSWORD'})
    assert response.status_code>=400
    async with session_factory() as db:
        row=await db.get(JourneyAttempt,aid);assert row and row.state=='failed' and j.decrypt_contact(row.contact_cipher)=='+79990000005'
        sess=await db.get(JourneySession,sid);assert sess.actor_id is None
        errors=(await db.scalars(select(JourneyIncident).where(JourneyIncident.attempt_id==aid))).all();assert errors
        for error in errors:error.next_notify_at=s.now()-timedelta(seconds=1)
        await db.commit()
        await j.maintenance(db);await db.commit();await j.maintenance(db);await db.commit()
        jobs=(await db.scalars(select(PushDelivery).where(PushDelivery.recipient_id==owner_id,PushDelivery.event_type=='journey_problem'))).all();assert len(jobs)==1
        assert jobs[0].payload['journey_session_id']==str(sid)
        assert jobs[0].payload['path']=='/admin/journeys?session='+str(sid)
        assert '+79990000005' not in jobs[0].body and 'NEVER_STORE' not in jobs[0].body
        assert await db.scalar(select(func.count()).select_from(UserNotification).where(UserNotification.user_id==owner_id))==1

@pytest.mark.asyncio
async def test_background_email_failure_records_no_code_and_success_is_monotonic(platform,session_factory,monkeypatch):
    async with session_factory() as db:
        row=await db.get(SprintSetting,'platform');row.value={**row.value,'journey_enabled':True};await db.commit()
    async def provider():
        async with session_factory() as db:yield db
    sid,vid,aid=uuid4(),uuid4(),uuid4()
    ctx={'session_id':sid,'visitor_id':vid,'attempt_id':aid,'kind':'auth','contact':'qa@example.invalid','db_provider':provider}
    token=j.context.set(ctx)
    try:
        from app.services.auth_email_service import send_auth_email_code
        from app.core.config import settings
        monkeypatch.setattr(settings,'SMTP_HOST','')
        await anyio.to_thread.run_sync(lambda:send_auth_email_code(to_email='qa@example.invalid',code='987654'))
    finally:j.context.reset(token)
    async with session_factory() as db:
        attempt=await db.get(JourneyAttempt,aid);assert attempt.state=='failed' and attempt.stage=='auth_delivery_failed'
        events=(await db.scalars(select(JourneyEvent).where(JourneyEvent.attempt_id==aid))).all()
        assert events[0].details=={'error_code':'EMAIL_NOT_CONFIGURED'} and '987654' not in str(events[0].details)
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='auth',source='server',event='auth_succeeded',state='succeeded');await db.commit()
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='auth',source='server',event='auth_delivery_failed',state='failed',details={'error_code':'EMAIL_DELIVERY_FAILED'});await db.commit()
        assert attempt.state=='succeeded'
        assert all(x.resolved for x in (await db.scalars(select(JourneyIncident).where(JourneyIncident.attempt_id==aid))).all())

@pytest.mark.asyncio
async def test_recreated_vehicle_same_account_keeps_original_trial_deadline(platform,session_factory):
    async with session_factory() as db:
        user,_=await create_actor(db,'driver');driver=user.driver_profile;driver.vehicle.plate_number='А678ВС777';await db.flush()
        initial=await s.activate_trial(db,user,'driver');await db.commit();end=initial['ends_at']
        driver.vehicle.is_active=False
        replacement=Vehicle(title='QA recreated record',brand='QA',plate_number='А678ВС777',is_active=True,moderation_status='approved');db.add(replacement);await db.flush()
        driver.vehicle=replacement;await db.commit()
        await s.register_vehicle(db,user,replacement.id,'driver');await db.commit()
        result=await s.access(db,user.id,'driver');assert result['active'] and result['ends_at']==end

@pytest.mark.asyncio
async def test_provider_problem_is_not_payment_failure_and_reopens_after_recovery(platform,session_factory,monkeypatch):
    from app.services import subscription_billing as billing,payments as provider
    from app.models.subscriptions import SubscriptionPlan,SubscriptionPayment
    from app.core.config import settings
    async with session_factory() as db:
        setting=await db.get(SprintSetting,'platform');setting.value={**setting.value,'journey_enabled':True};await db.commit()
        user,_=await create_actor(db,'supplier');plan=SubscriptionPlan(category='quarry',name='QA transient',months=1,amount=1,published=True,test_only=True);db.add(plan);await db.flush()
        payment=await billing.create(db,user,plan.id,uuid4(),'qa@example.invalid');await db.commit();pid=payment.id;metadata=payment.body['metadata']
        sid,vid,aid=uuid4(),uuid4(),uuid4()
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='subscription',event='subscription_payment_created',source='server',state='pending',payment_id=pid);await db.commit()
    async def unavailable(*args,**kwargs):raise provider.ProviderError()
    monkeypatch.setattr(provider,'provider',unavailable)
    async with session_factory() as db:await billing.process(db,'payment',pid)
    async with session_factory() as db:
        row=await db.get(JourneyAttempt,aid);assert row.state=='pending'
        incidents=list((await db.scalars(select(JourneyIncident).where(JourneyIncident.attempt_id==aid))).all());assert len(incidents)==1 and not incidents[0].resolved
    result={'id':uuid4().hex,'status':'pending','test':True,'recipient':{'account_id':settings.YOOKASSA_SHOP_ID},'metadata':metadata,'amount':{'value':'1.00','currency':'RUB'}}
    async def recovered(*args,**kwargs):return result
    monkeypatch.setattr(provider,'provider',recovered)
    async with session_factory() as db:await billing.process(db,'payment',pid)
    async with session_factory() as db:
        row=await db.get(JourneyAttempt,aid);assert row.state=='pending'
        incident=await db.scalar(select(JourneyIncident).where(JourneyIncident.attempt_id==aid));assert incident.resolved
        events=(await db.scalars(select(JourneyEvent).where(JourneyEvent.attempt_id==aid,JourneyEvent.event=='subscription_provider_recovered'))).all();assert events and events[0].details=={}
    monkeypatch.setattr(provider,'provider',unavailable)
    async with session_factory() as db:await billing.process(db,'payment',pid)
    async with session_factory() as db:
        incidents=list((await db.scalars(select(JourneyIncident).where(JourneyIncident.attempt_id==aid))).all());assert len(incidents)==1
        assert not incidents[0].resolved and incidents[0].count==2

@pytest.mark.asyncio
async def test_verified_get_links_current_account_without_extending_attempt(platform,client,session_factory):
    async with session_factory() as db:
        setting=await db.get(SprintSetting,'platform');setting.value={**setting.value,'journey_enabled':True};await db.commit()
        user,headers=await create_actor(db,'supplier');await db.commit();uid=user.id
        sid,vid,aid=uuid4(),uuid4(),uuid4()
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='order',event='order_started',source='client')
        row=await db.get(JourneyAttempt,aid);old=s.now()-timedelta(hours=2);row.last_at=old;await db.commit()
    response=await client.get('/api/v1/subscriptions/me',headers={**headers,'X-Visitor-Id':str(vid),'X-Session-Id':str(sid)})
    assert response.status_code==200,response.text
    async with session_factory() as db:
        session=await db.get(JourneySession,sid);assert session.actor_id==uid and session.actor_type=='user'
        attempt=await db.get(JourneyAttempt,aid);assert attempt.last_at==old

@pytest.mark.asyncio
async def test_order_status_history_catches_up_after_creation_link_race(platform,session_factory):
    from app.models.models import Client,Order,OrderEvent
    async with session_factory() as db:
        setting=await db.get(SprintSetting,'platform');setting.value={**setting.value,'journey_enabled':True};await db.commit()
        customer=Client(name='QA race',email=uuid4().hex+'@example.invalid');db.add(customer);await db.flush()
        order=Order(client_id=customer.id,status='completed',total_amount=10);db.add(order);await db.flush()
        for status,seconds in [('driver_assigned',5),('completed',1)]:
            db.add(OrderEvent(order_id=order.id,status=status,event_type='QA status',created_at=s.now()-timedelta(seconds=seconds)))
        await db.commit()
        sid,vid,aid=uuid4(),uuid4(),uuid4()
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='order',event='order_created',source='server',state='succeeded',order_id=order.id);await db.commit()
        for _ in range(2):await j.reconcile_orders(db);await db.commit()
        attempt=await db.get(JourneyAttempt,aid);assert attempt.order_synced and attempt.stage=='completed'
        events=(await db.scalars(select(JourneyEvent).where(JourneyEvent.attempt_id==aid))).all()
        assert sorted(x.event for x in events)==['completed','driver_assigned','order_created']


@pytest.mark.asyncio
async def test_two_checkout_items_and_retry_keep_separate_attempt_links(platform,client,session_factory,monkeypatch):
    """Exercise correlation/idempotent replay at the HTTP boundary without routing/network I/O."""
    from app.api import orders as api
    from app.models.models import Client,Order
    from app.security.jwt import create_access_token
    from types import SimpleNamespace
    async with session_factory() as db:
        setting=await db.get(SprintSetting,'platform');setting.value={**setting.value,'journey_enabled':True};await db.commit()
        customer=Client(name='QA cart',email=uuid4().hex+'@example.invalid');db.add(customer);await db.commit();cid=customer.id
        token=create_access_token({'sub':str(cid),'role':'client','client_id':str(cid)})
    # Idempotency storage is tested separately; preserve its replay contract here.
    stored={}
    async def reserve(key,*,client_id):
        return SimpleNamespace(existing_order_id=stored.get(key),key=key)
    async def complete(reservation,order_id):stored[reservation.key]=order_id
    async def create(db,*,client_id,**kwargs):
        order=Order(client_id=client_id,status='new',total_amount=10,settlement_mode='direct');db.add(order);await db.flush();oid=order.id;await db.commit()
        j.mark_order(oid);return await api.get_order_by_id(db,oid)
    monkeypatch.setattr(api,'reserve_order_idempotency_key',reserve)
    monkeypatch.setattr(api,'complete_order_idempotency_key',complete)
    monkeypatch.setattr(api,'create_checkout_order',create)
    sid,vid,parent=uuid4(),uuid4(),uuid4();children=[uuid4(),uuid4()]
    headers={'Authorization':'Bearer '+token,'X-Visitor-Id':str(vid),'X-Session-Id':str(sid),'X-Cart-Attempt-Id':str(parent),'X-Attempt-Kind':'order'}
    payload={'material_id':str(uuid4()),'delivery_option_id':str(uuid4()),'delivery_address':'QA address'}
    ids=[]
    for child in children:
        response=await client.post('/api/v1/orders/checkout',headers={**headers,'X-Attempt-Id':str(child),'Idempotency-Key':str(child)},json=payload)
        assert response.status_code==201,response.text
        ids.append(response.json()['id'])
    # Retry without the create service: the existing-order branch must mark the order too.
    response=await client.post('/api/v1/orders/checkout',headers={**headers,'X-Attempt-Id':str(children[0]),'Idempotency-Key':str(children[0])},json=payload)
    assert response.status_code==201 and response.json()['id']==ids[0]
    async with session_factory() as db:
        rows=[await db.get(JourneyAttempt,child) for child in children]
        assert [str(row.order_id) for row in rows]==ids
        assert all(row.state=='succeeded' for row in rows)
        cart=await db.get(JourneyAttempt,parent);assert cart.state=='succeeded' and cart.order_id is None
        assert await db.scalar(select(func.count()).select_from(JourneyEvent).where(JourneyEvent.attempt_id==parent,JourneyEvent.event=='cart_submitted'))==2
