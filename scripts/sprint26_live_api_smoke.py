"""Live test-only API/ledger smoke. All mutations are scoped to dedicated S26 QA actors.

Run through the guarded test runtime runner. No server env edits, customer orders,
real payment instruments or notifications to existing customer/staff accounts.
"""
import asyncio,json,sys,hashlib
from pathlib import Path
from uuid import UUID,uuid4
from datetime import timedelta
from decimal import Decimal
import httpx
from sqlalchemy import select,func
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import User,WaterPoint,Material,Category
from app.models.subscriptions import AccessGrant,SubscriptionPayment,SubscriptionRefund,JourneyAttempt,JourneyEvent,SubscriptionAudit
from app.services import subscriptions as s
ROOT=Path('/opt/darmavoz_test_backups/sprint26')
BASE='https://test.darmavoz.ru/api/v1'

async def run():
    assert settings.PAYMENT_TEST_MODE and settings.YOOKASSA_SECRET_KEY.startswith('test_')
    qa=json.loads((ROOT/'qa-auth.json').read_text())
    async with AsyncSessionLocal() as db:
        assert db.bind.url.database=='darmavoz_test'
        for role in ['admin','logist','supplier','driver','equipment_owner','water_septic_partner']:
            user=await db.get(User,UUID(qa[role]['id']));assert user and user.username=='s26-qa-release-'+role
    result={'environment':'test','checks':[]}
    async with httpx.AsyncClient(base_url=BASE,timeout=45) as client:
        async def api(path,actor=None,body=None,expected=200):
            response=await client.request('POST' if body is not None else 'GET',path,
                headers={'Authorization':'Bearer '+qa[actor]['token']} if actor else {},json=body)
            assert response.status_code==expected,(path,response.status_code)
            return response.json()
        assert (await api('/payments/config','admin'))['test_mode']
        mode=sys.argv[1] if len(sys.argv)>1 else 'resources'
        if mode=='resources':
            params='?city_id='+qa['city_id'];phone='+70000000026'
            snapshots={}
            for category,path,key,actor in [('water','/water-points','water_id','water_septic_partner'),('septic','/septic-providers','septic_id','water_septic_partner'),('equipment','/equipment','equipment_id','equipment_owner')]:
                rows=await api(path+params);row=next(x for x in rows if x['id']==qa[key])
                if not row.get('can_order'):
                    assert phone not in json.dumps(row),'QA contact leaked while inactive'
                    snapshots[category]='inactive contacts redacted'
                first=await api('/subscriptions/trial',actor,{'category':category});again=await api('/subscriptions/trial',actor,{'category':category})
                assert first['active'] and first['ends_at']==again['ends_at']
                row=next(x for x in await api(path+params) if x['id']==qa[key]);assert row['can_order'] and phone in json.dumps(row)
            global_before=await api('/pickup-points/global'+params)
            storage=next(x for x in global_before if x['id']==qa['points']['accumulator'])
            if not storage['can_order']:assert phone not in json.dumps(storage)
            for category in ['accumulator','firewood']:
                one=await api('/subscriptions/trial','supplier',{'category':category});two=await api('/subscriptions/trial','supplier',{'category':category});assert one['active'] and one['ends_at']==two['ends_at']
            global_after=await api('/pickup-points/global'+params)
            assert all(next(x for x in global_after if x['id']==qa['points'][key])['can_order'] for key in ['quarry','accumulator','supplier'])
            water=await api('/water-points'+params)
            async with AsyncSessionLocal() as db:
                staging=set(str(x) for x in (await db.scalars(select(WaterPoint.id).where(WaterPoint.water_type=='unknown',WaterPoint.is_deleted.is_(False)))).all())
                assert not staging.intersection(x['id'] for x in water)
                assert not await db.scalar(select(func.count()).select_from(WaterPoint).where(WaterPoint.water_type=='free'))
                catalog=[{'name':name,'is_free':is_free,'category':cat} for name,is_free,cat in (await db.execute(select(Material.name,Material.is_free,Category.name).join(Category,Material.category_id==Category.id).where(Material.is_free.is_(True),Material.is_active.is_(True)))).all()]
            free_payload={'city_id':qa['city_id'],'water_type':'free','is_free':True,'name':'QA forbidden free point','source':'QA','address':'QA test','lat':57.15,'lon':65.53,'phone':phone,'price':1,'price_unit':'1 м³'}
            await api('/water-septic-partner/water-points','water_septic_partner',free_payload,422)
            await api('/admin/water-points','admin',free_payload,422)
            payload={'material_id':qa['material_id'],'delivery_option_id':qa['delivery_option_id'],'city_id':qa['city_id'],'delivery_lat':57.16,'delivery_lon':65.54,'quantity':1,'volume':10}
            automatic=await api('/client/orders/calculate',None,payload)
            assert automatic['best_option']['point_type']=='quarry'
            manual=await api('/client/orders/calculate',None,{**payload,'quarry_id':qa['points']['accumulator']})
            assert manual['best_option']['quarry_id']==qa['points']['accumulator'] and Decimal(str(manual['best_option']['material_cost']))==Decimal('10') and Decimal(str(manual['best_option']['delivery_cost']))==0 and Decimal(str(manual['best_option']['total_amount']))==10
            await api('/orders/'+qa['client']['order_id']+'/payments','client',{'email':'s26-qa-receipt@example.com'},409)
            await api('/subscriptions/admin/settings','logist',None,403)
            await api('/admin/journeys','supplier',None,403)
            result.update(resource_initial=snapshots,staging_water_hidden=len(staging),free_catalog_materials=catalog,manual_storage_total='10.00',delivery='0.00')
            result['checks']+=['public contacts hidden before access and restored after explicit trial','trial activation idempotent in water/septic/equipment/accumulator/firewood','free water create rejected for partner and admin; staging hidden','automatic selection quarry-only; manual storage 10m3 x 1 RUB + zero delivery','old order-payment endpoint blocked; admin analytics/settings RBAC']
        elif mode=='catalog':
            from app.models.models import quarry_materials
            async with AsyncSessionLocal() as db:
                rows=(await db.execute(select(Material.id,Material.name,Material.is_free,Category.name).join(Category,Material.category_id==Category.id).where(Material.is_free.is_(True),Material.is_active.is_(True)))).all()
                values=[]
                for mid,name,free,cat in rows:
                    count=await db.scalar(select(func.count()).select_from(quarry_materials).where(quarry_materials.c.material_id==mid))
                    values.append({'id':str(mid),'name':name,'category':cat,'offers':count})
                result['free_catalog_materials']=values
        elif mode=='sandbox':
            ids=[UUID(x) for x in qa['sandbox_payment_ids']]
            async def grants():
                async with AsyncSessionLocal() as db:
                    rows=(await db.scalars(select(AccessGrant).where(AccessGrant.account_id==UUID(qa['supplier']['id'])).order_by(AccessGrant.source_key))).all()
                    return [(str(x.id),x.source_key,x.starts_at.isoformat(),x.ends_at.isoformat(),x.revoked) for x in rows]
            before=await grants()
            async with AsyncSessionLocal() as db:
                payments=(await db.scalars(select(SubscriptionPayment).where(SubscriptionPayment.id.in_(ids)))).all()
                refunds=(await db.scalars(select(SubscriptionRefund).where(SubscriptionRefund.payment_id.in_(ids),SubscriptionRefund.status=='succeeded'))).all()
                payment_rows=[(x.id,x.provider_id,x.request_id,x.plan_id,x.body['receipt']['customer']['email']) for x in payments if x.status=='succeeded']
                refund_rows=[(x.id,x.provider_id,x.payment_id,x.amount) for x in refunds]
            for pid,provider_id,request_id,plan_id,email in payment_rows:
                for _ in range(2):await api('/webhooks/yookassa',None,{'type':'notification','event':'payment.succeeded','object':{'id':provider_id,'status':'canceled'}})
                replay=await api('/subscriptions/payments','supplier',{'request_id':str(request_id),'plan_id':str(plan_id),'email':email},202);assert replay['id']==str(pid)
            for rid,provider_id,pid,amount in refund_rows:
                for _ in range(2):await api('/webhooks/yookassa',None,{'type':'notification','event':'refund.succeeded','object':{'id':provider_id,'payment_id':next(p[1] for p in payment_rows if p[0]==pid)}})
            after=await grants();assert before==after,'Replay changed existing/source/other access grants'
            for pid,*_ in payment_rows:assert sum(x[1]=='payment:'+str(pid) for x in after)==1
            assert any(x[0]==qa['refund_other_grant_id'] and not x[4] for x in after)
            async with AsyncSessionLocal() as db:
                attempts=(await db.scalars(select(JourneyAttempt).where(JourneyAttempt.payment_id.in_(ids)))).all()
                statuses={x.id:x.status for x in payments}
                assert all(x.state=='succeeded' for x in attempts if statuses[x.payment_id]=='succeeded')
                renewals=await db.scalar(select(func.count()).select_from(SubscriptionAudit).where(SubscriptionAudit.account_id==UUID(qa['supplier']['id']),SubscriptionAudit.action=='subscription_renewed'))
                assert renewals>=1
                renewal_events=await db.scalar(select(func.count()).select_from(JourneyEvent).where(JourneyEvent.event=='subscription_renewed',JourneyEvent.attempt_id.in_([x.id for x in attempts])))
                assert renewal_events>=1
            result.update(successful_payments=len(payment_rows),successful_refunds=len(refund_rows),grants_unchanged_on_replay=True,revoked_source_grants=sum(x[4] for x in after if x[1].startswith('payment:')),payment_attempts=len(attempts),renewals=renewals,renewal_events=renewal_events)
            result['checks']+=['real test-provider webhook GET verification and duplicate webhook replay','same payment request reuses the existing operation','source/independent/previous-payment grants unchanged by partial refund keep and replay','all linked attempts succeeded; renewal has audit and journey event']
        else:raise ValueError('Use resources or sandbox')
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':asyncio.run(run())
