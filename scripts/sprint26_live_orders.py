"""QA-only end-to-end API handlers on the actual test DB.

ASGI requests use the real handlers, DB, Redis, pricing and admission rules. Only
notification transport is restricted to the dedicated QA recipients. The external
dispatch worker is excluded from these UUIDs by a bounded Redis lock; customer
orders, operator recipients and server configuration are never modified.
"""
import asyncio,json
from pathlib import Path
from uuid import UUID,uuid4
from datetime import timedelta
from decimal import Decimal
import httpx
from sqlalchemy import select,event,update
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import User,Order,Driver,Client,UserNotification,PushDelivery
from app.models.subscriptions import CategoryAccess,JourneyAttempt,JourneyEvent
from app.services import subscriptions as s,dispatch_service as d,notification_outbox as outbox
from app.services.redis_client import get_redis
from main import app

async def run():
    assert settings.PAYMENT_TEST_MODE and settings.YOOKASSA_SECRET_KEY.startswith('test_')
    qa=json.loads(Path('/opt/darmavoz_test_backups/sprint26/qa-auth.json').read_text())
    uid=UUID(qa['driver']['id']);did=UUID(qa['driver']['driverId']);cid=UUID(qa['client']['id'])
    async with AsyncSessionLocal() as db:
        assert db.bind.url.database=='darmavoz_test'
        driver=await db.get(Driver,did);user=await db.get(User,uid)
        assert driver.user_id==uid and user.username=='s26-qa-release-driver'
        customer=await db.get(Client,cid);assert customer.email=='s26-qa-checkout@example.invalid'
        if not customer.phone:customer.phone='+70000000027';await db.commit()
        assert not (await s.access(db,uid,'driver'))['active'] and not (await s.access(db,uid,'carrier'))['active'], 'Run initial notice/manual gate check before activating driver'
    allowed={'user':{UUID(qa[x]['id']) for x in ['admin','logist','supplier','driver','equipment_owner','water_septic_partner']},'driver':{did},'client':{cid}}
    original_enqueue=outbox.enqueue
    suppressed=0
    async def qa_enqueue(session,**kw):
        nonlocal suppressed
        if kw['recipient_id'] not in allowed.get(kw['recipient_type'],set()):suppressed+=1;return False
        return await original_enqueue(session,**kw)
    outbox.enqueue=qa_enqueue
    state={'order_id':uuid4()};created=[];periods={};success=False
    def before_insert(mapper,connection,target):
        if target.client_id==cid and target.source=='s26-qa-e2e':
            target.id=state['order_id'];target.next_dispatch_at=s.now()+timedelta(hours=1)
    event.listen(Order,'before_insert',before_insert)
    redis=get_redis();locks=[]
    session_id,visitor_id,attempt_id=uuid4(),uuid4(),uuid4()
    result={'environment':'test','transport':'real ASGI handlers + actual test DB/Redis; QA-only notification delivery','checks':[]}
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://s26-qa',timeout=60) as client:
            async def api(method,path,actor='client',body=None,expected=200,journey=False,idem=None):
                headers={'Authorization':'Bearer '+qa[actor]['token']}
                if journey:headers.update({'X-Visitor-Id':str(visitor_id),'X-Session-Id':str(session_id),'X-Attempt-Id':str(attempt_id),'X-Journey-City-Id':qa['city_id'],'X-Attempt-Kind':'receipt' if path.endswith('/received') else 'review' if path.endswith('/review') else 'order'})
                if idem:headers['Idempotency-Key']=idem
                r=await client.request(method,'/api/v1'+path,headers=headers,json=body)
                assert r.status_code==expected,(path,r.status_code,(r.json().get('code') or r.json().get('detail')) if r.status_code>=400 else '')
                return r.json()
            storage = await api('GET','/pickup-points/'+qa['points']['accumulator']+'?city_id='+qa['city_id']+'&material_id='+qa['material_id'])
            if not storage.get('can_order',False):assert storage.get('contact_phone') is None
            await api('POST','/subscriptions/trial',actor='supplier',body={'category':'accumulator'})
            payload={'city_id':qa['city_id'],'material_id':qa['material_id'],'delivery_option_id':qa['delivery_option_id'],'quarry_id':qa['points']['accumulator'],'delivery_address':'Тюмень, тестовый адрес С26','delivery_lat':57.16,'delivery_lon':65.54,'volume':10,'quantity':1,'source':'s26-qa-e2e'}
            oid=state['order_id'];key=str(oid)
            assert await redis.set('dispatch:order:'+str(oid),'QA scoped no customer notifications',nx=True,ex=600);locks.append(oid)
            order=await api('POST','/orders/checkout',body=payload,expected=201,journey=True,idem=key);created.append(oid)
            assert order['id']==str(oid) and order['settlement_mode']=='direct' and Decimal(str(order['total_amount']))==10 and Decimal(str(order['delivery_cost']))==0
            replay=await api('POST','/orders/checkout',body=payload,expected=201,journey=True,idem=key);assert replay['id']==order['id']
            await api('POST','/orders/'+str(oid)+'/payments',body={'email':'s26-qa@example.com'},expected=409)
            print(json.dumps({'qa_order_status':order['status'],'clarification_reasons':order.get('clarification_reasons')}))
            denied=await api('POST','/orders/'+str(oid)+'/assign',actor='logist',body={'driver_id':str(did)},expected=409)
            assert denied.get('code')=='DRIVER_SUBSCRIPTION_REQUIRED',denied
            one=await api('POST','/subscriptions/trial',actor='driver',body={'category':'driver'})
            two=await api('POST','/subscriptions/trial',actor='driver',body={'category':'carrier'})
            assert one['active'] and two['active'] and one['ends_at']==two['ends_at']
            assigned=await api('POST','/orders/'+str(oid)+'/assign',actor='logist',body={'driver_id':str(did)})
            assert assigned['status']=='driver_assigned'
            async with AsyncSessionLocal() as db:
                rows=(await db.scalars(select(CategoryAccess).where(CategoryAccess.account_id==uid,CategoryAccess.category.in_(['driver','carrier'])))).all()
                for x in rows:
                    periods[x.id]=(x.trial_started_at,x.trial_ends_at);x.trial_started_at=s.now()-timedelta(days=15);x.trial_ends_at=s.now()-timedelta(seconds=1)
                await db.commit()
            assert not (await api('GET','/subscriptions/me',actor='driver'))['transport_access']
            for status in ['heading_to_pickup','arrived_at_pickup','loading','heading_to_client','delivered','completed']:
                changed=await api('PATCH','/driver/orders/'+str(oid)+'/status',actor='driver',body={'status':status});assert changed['status']==status
            # Receipt and review are separate attempts, as on the real client.
            attempt_id=uuid4();await api('POST','/client/orders/'+str(oid)+'/received',body={},journey=True)
            attempt_id=uuid4();review=await api('POST','/client/orders/'+str(oid)+'/review',body={'rating':5,'comment':'QA С26 доставка завершена после окончания доступа'},journey=True)
            repeated=await api('POST','/client/orders/'+str(oid)+'/review',body={'rating':5,'comment':'QA С26 доставка завершена после окончания доступа'},journey=True)
            assert review['rating']==repeated['rating']==5
            async with AsyncSessionLocal() as db:
                for key,period in periods.items():
                    row=await db.get(CategoryAccess,key);row.trial_started_at,row.trial_ends_at=period
                await db.commit()
            # A second order stays a distinct journey chain and is manually assigned
            # before releasing its worker lock; it is completed using the normal API.
            second=uuid4();state['order_id']=second;attempt_id=uuid4()
            assert await redis.set('dispatch:order:'+str(second),'QA scoped no customer notifications',nx=True,ex=600);locks.append(second)
            await api('POST','/orders/checkout',body=payload,expected=201,journey=True,idem=str(second));created.append(second)
            await api('POST','/orders/'+str(second)+'/assign',actor='logist',body={'driver_id':str(did)})
            for status in ['heading_to_pickup','arrived_at_pickup','loading','heading_to_client','delivered','completed']:
                await api('PATCH','/driver/orders/'+str(second)+'/status',actor='driver',body={'status':status})
            async with AsyncSessionLocal() as db:
                driver=await db.get(Driver,did);assert driver.status=='available'
                assert await db.scalar(select(func_count()).select_from(Order).where(Order.id.in_(created)))==2
                attempts=(await db.scalars(select(JourneyAttempt).where(JourneyAttempt.session_id==session_id,JourneyAttempt.kind=='order'))).all()
                assert {x.order_id for x in attempts}==set(created)
                notices=(await db.scalars(select(UserNotification).where(UserNotification.payload['order_id'].astext.in_([str(x) for x in created])))).all()
                assert all(x.user_id in allowed['user'] for x in notices)
                jobs=(await db.scalars(select(PushDelivery).where(PushDelivery.payload['order_id'].astext.in_([str(x) for x in created])))).all()
                assert all(x.recipient_id in allowed.get(x.recipient_type,set()) for x in jobs)
            result.update(order_ids=[str(x) for x in created],total_per_order='10.00',delivery_per_order='0.00',order_attempts=len(attempts),suppressed_non_QA_deliveries=suppressed,qa_notification_jobs=len(jobs),physical_push='not verified')
            result['checks']=['manual accumulator checkout with direct settlement and idempotent retry','legacy order-payment API blocked','unsubscribed driver manual assignment denied; driver/carrier share trial deadline','assigned delivery completed after both transport categories expired; trial dates restored','driver released, client receipt and idempotent review','second complete order has separate journey chain','notification rows/deliveries scoped exclusively to QA recipients']
            success=True
    finally:
        outbox.enqueue=original_enqueue;event.remove(Order,'before_insert',before_insert)
        async with AsyncSessionLocal() as db:
            for key,period in periods.items():
                row=await db.get(CategoryAccess,key)
                if row:row.trial_started_at,row.trial_ends_at=period
            if not success:
                # Keep a failed QA run from reaching the normal external dispatcher.
                for oid in locks:
                    order=await db.get(Order,oid)
                    if order and order.source=='s26-qa-e2e' and order.client_id==cid and order.status!='completed':order.status='cancelled';order.is_deleted=True
                driver=await db.get(Driver,did)
                if driver:driver.status='available'
            await db.commit()
        for oid in locks:await redis.delete('dispatch:order:'+str(oid))
        await redis.aclose()
    print(json.dumps(result,ensure_ascii=False))

def func_count():
    from sqlalchemy import func
    return func.count()

if __name__=='__main__':asyncio.run(run())
