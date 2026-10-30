from uuid import uuid4
from datetime import timedelta
import pytest
from sqlalchemy import select,text
from sqlalchemy.exc import IntegrityError
from app.models.models import WaterPoint,Client,Order,Quarry,City
from app.models.subscriptions import SprintSetting
from app.security.jwt import create_access_token
from app.services import subscriptions as s
from tests.test_sprint26_subscriptions import platform,create_actor

@pytest.mark.asyncio
async def test_water_free_rejected_through_api_and_database_unknown_only_staged(platform,client,session_factory,admin_token):
    async with session_factory() as db:
        row=await db.get(SprintSetting,'platform');row.value={**row.value,'water_paid_only':True};await db.commit()
        user,headers=await create_actor(db,'water_septic_partner');await db.commit();uid=user.id
    payload={'water_type':'free','source':'QA','lat':57.1,'lon':65.5,'is_free':True}
    for route,auth in [('/api/v1/water-septic-partner/water-points',headers),('/api/v1/admin/water-points',{'Authorization':'Bearer '+admin_token})]:
        response=await client.post(route,headers=auth,json=payload);assert response.status_code==422,response.text
    async with session_factory() as db:
        db.add(WaterPoint(owner_user_id=uid,water_type='free',source='QA',lat=57.1,lon=65.5,is_free=True))
        with pytest.raises(IntegrityError):await db.commit()
        await db.rollback()
        point=WaterPoint(owner_user_id=uid,water_type='unknown',source='QA commercial import staging',lat=57.1,lon=65.5,
            is_free=False,is_active=False,moderation_status='pending_moderation',crm_status='auto_added')
        db.add(point);await db.commit();pid=point.id
        point.moderation_status='approved';point.is_active=True
        with pytest.raises(IntegrityError):await db.commit()
        await db.rollback()
        point=await db.get(WaterPoint,pid);point.water_type='paid';point.name='QA seller';point.phone='+79990000004';point.price=1;point.price_unit='1 м³';point.moderation_status='approved';point.crm_status='activated';point.is_active=True
        await db.commit()
    assert (await client.post('/api/v1/water-septic-partner/water-points',headers=headers,json={**payload,'water_type':'paid','is_free':False,'name':'QA water','phone':'+79990000004','price':1,'price_unit':'1 м³'})).status_code==201

@pytest.mark.asyncio
async def test_admin_accounts_and_plans_rbac_and_cache_headers(platform,client,session_factory,admin_token):
    async with session_factory() as db:
        user,headers=await create_actor(db,'supplier');user.display_name='QA lookup '+uuid4().hex;await db.commit();uid=str(user.id)
    admin={'Authorization':'Bearer '+admin_token}
    result=await client.get('/api/v1/subscriptions/admin/accounts',params={'q':uid},headers=admin)
    assert result.status_code==200,result.text
    assert [x['id'] for x in result.json()]==[uid]
    assert (await client.get('/api/v1/subscriptions/admin/accounts',headers=headers)).status_code==403
    result=await client.get('/api/v1/subscriptions/me',headers=headers);assert 'no-store' in result.headers['cache-control']
    bad={'category':'carrier','name':'QA unapproved carrier','months':1,'amount':None,'published':True,'test_only':False}
    assert (await client.post('/api/v1/subscriptions/admin/plans',headers=admin,json=bad)).status_code==422
    bad['published']=False
    assert (await client.post('/api/v1/subscriptions/admin/plans',headers=admin,json=bad)).status_code==201

@pytest.mark.asyncio
async def test_ordinary_client_subscription_overview_and_single_review(platform,client,session_factory):
    async with session_factory() as db:
        customer=Client(name='QA client',email=uuid4().hex+'@example.invalid');other=Client(name='QA other',email=uuid4().hex+'@example.invalid');db.add_all([customer,other]);await db.flush()
        order=Order(client_id=customer.id,status='delivered',settlement_mode='direct',total_amount=10);db.add(order);await db.commit();oid=str(order.id)
        def headers(c):return {'Authorization':'Bearer '+create_access_token({'sub':c.email,'role':'client','client_id':str(c.id)})}
        own,foreign=headers(customer),headers(other)
    result=await client.get('/api/v1/subscriptions/me',headers=own);assert result.status_code==200 and result.json()['categories']==[]
    assert (await client.get('/api/v1/subscriptions/plans',headers=own)).json()==[]
    assert (await client.get('/api/v1/subscriptions/payments',headers=own)).json()==[]
    assert (await client.get('/api/v1/chat/messages',headers=own)).status_code==403
    base='/api/v1/client/orders/'+oid
    assert (await client.post(base+'/received',headers=foreign)).status_code==404
    assert (await client.post(base+'/review',headers=own,json={'rating':5})).status_code==409
    assert (await client.post(base+'/received',headers=own)).status_code==200
    for _ in range(2):assert (await client.post(base+'/review',headers=own,json={'rating':5,'comment':'QA review'})).status_code==200
    assert (await client.post(base+'/review',headers=own,json={'rating':1,'comment':'changed'})).status_code==409

@pytest.mark.asyncio
async def test_manual_hidden_point_stays_hidden_despite_valid_subscription(platform,client,session_factory):
    async with session_factory() as db:
        user,_=await create_actor(db,'supplier');await s.activate_trial(db,user,'quarry');city=await db.scalar(select(City).where(City.code=='tyumen'))
        point=Quarry(city_id=city.id,owner_user_id=user.id,name='QA hidden',address='QA',lat=57.1,lon=65.5,point_type='quarry',crm_status='activated',moderation_status='approved',placement_status='hidden',placement_hidden_reason='manual',is_active=False)
        db.add(point);await db.commit();pid=str(point.id);cid=str(city.id)
    response=await client.get('/api/v1/pickup-points/global',params={'city_id':cid});assert response.status_code==200,response.text
    assert all(x['id']!=pid for x in response.json())
    assert (await client.get('/api/v1/pickup-points/'+pid,params={'city_id':cid})).status_code==404


@pytest.mark.asyncio
async def test_water_cleanup_backs_up_dependencies_and_rejects_stale_preview(platform,session_factory,monkeypatch,tmp_path,capsys):
    import json,gzip,hashlib
    from types import SimpleNamespace
    from scripts import sprint26_water_cleanup as cleanup
    from app.models.models import MediaFile,PointAuditLog
    monkeypatch.setattr(cleanup,'AsyncSessionLocal',session_factory)
    monkeypatch.setattr(cleanup,'BACKUP_ROOT',tmp_path/'private-backups')
    async with session_factory() as db:
        point=WaterPoint(water_type='free',source='QA cleanup',lat=57.1,lon=65.5,is_free=True);db.add(point);await db.flush();pid=point.id
        media=MediaFile(entity_type='water_point',entity_id=pid,bucket='qa',object_key=uuid4().hex,public_url='https://example.invalid/qa',content_type='image/png',file_name='qa.png',file_size=10)
        audit=PointAuditLog(point_id=pid,point_kind='water',new_status='auto_added');db.add_all([media,audit]);await db.commit();mid=media.id;logid=audit.id
    await cleanup.run(SimpleNamespace(apply=False,expect_sha=None));preview=json.loads(capsys.readouterr().out)
    assert str(pid) in preview['free_point_ids'] and not preview['applied']
    async with session_factory() as db:
        point=await db.get(WaterPoint,pid);point.name='QA changed after preview';await db.commit()
    with pytest.raises(RuntimeError,match='PREVIEW_CHANGED'):
        await cleanup.run(SimpleNamespace(apply=True,expect_sha=preview['preview_sha256']))
    assert not (tmp_path/'private-backups').exists()
    await cleanup.run(SimpleNamespace(apply=False,expect_sha=None));preview=json.loads(capsys.readouterr().out)
    await cleanup.run(SimpleNamespace(apply=True,expect_sha=preview['preview_sha256']));applied=json.loads(capsys.readouterr().out)
    from pathlib import Path
    archive=Path(applied['backup_path']);assert archive.stat().st_mode & 0o777==0o600
    with gzip.open(archive,'rb') as file:body=file.read()
    assert hashlib.sha256(body).hexdigest()==preview['preview_sha256']
    saved=json.loads(body);assert any(x['id']==str(pid) for x in saved['water_points'])
    assert any(x['id']==str(mid) for x in saved['media_files'])
    assert any(x['id']==str(logid) for x in saved['point_audit_log'])
    async with session_factory() as db:
        assert await db.get(WaterPoint,pid) is None and await db.get(MediaFile,mid) is None and await db.get(PointAuditLog,logid) is None

@pytest.mark.asyncio
async def test_water_cleanup_refuses_unreviewed_foreign_key(platform,session_factory,monkeypatch):
    from scripts import sprint26_water_cleanup as cleanup
    from types import SimpleNamespace
    monkeypatch.setattr(cleanup,'AsyncSessionLocal',session_factory)
    async with session_factory() as db:
        await db.execute(text('CREATE TABLE s26_qa_water_dependency (id uuid PRIMARY KEY, point_id uuid REFERENCES water_points(id))'));await db.commit()
    try:
        with pytest.raises(RuntimeError,match='UNREVIEWED_FOREIGN_KEYS'):
            await cleanup.run(SimpleNamespace(apply=False,expect_sha=None))
    finally:
        async with session_factory() as db:
            await db.execute(text('DROP TABLE s26_qa_water_dependency'));await db.commit()
