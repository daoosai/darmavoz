"""API-level S26 checks. Disposable DB only; all provider I/O is mocked."""
from datetime import timedelta
from uuid import uuid4
import pytest
from sqlalchemy import select
from app.models.subscriptions import SprintSetting, CategoryAccess, ChatAudit, ChatMessage, JourneyAttempt, JourneyEvent, SubscriptionPayment
from app.services import subscriptions as s, journey as j, subscription_billing as b
from tests.test_sprint26_subscriptions import platform, create_actor

async def enable(session_factory):
    async with session_factory() as db:
        row=await db.get(SprintSetting,'platform');row.value={**row.value,'chat_enabled':True,'journey_enabled':True,'notify_push':False,'owner_id':None};await db.commit()

@pytest.mark.asyncio
async def test_chat_access_dedup_expiry_and_moderation(platform,client,session_factory,admin_token):
    await enable(session_factory)
    admin={'Authorization':'Bearer '+admin_token}
    async with session_factory() as db:
        user,headers=await create_actor(db,'supplier');await db.commit();uid=user.id
    assert (await client.get('/api/v1/chat/messages',headers=headers)).status_code==403
    assert (await client.post('/api/v1/subscriptions/trial',headers=headers,json={'category':'quarry'})).status_code==200
    body={'request_id':str(uuid4()),'text':'QA сообщение'}
    one=await client.post('/api/v1/chat/messages',headers=headers,json=body);assert one.status_code==201,one.text
    again=await client.post('/api/v1/chat/messages',headers=headers,json=body);assert again.json()['id']==one.json()['id']
    conflict=await client.post('/api/v1/chat/messages',headers=headers,json={**body,'text':'другой текст'});assert conflict.status_code==409
    mid=one.json()['id']
    action={'action':'pin','message_id':mid,'reason':'QA проверка'}
    assert (await client.post('/api/v1/chat/moderation',headers=headers,json=action)).status_code==403
    assert (await client.post('/api/v1/chat/moderation',headers=admin,json=action)).status_code==200
    room=(await client.get('/api/v1/chat/messages',headers=headers)).json();assert any(x['id']==mid for x in room['pins'])
    assert (await client.post('/api/v1/chat/moderation',headers=admin,json={**action,'action':'delete'})).status_code==200
    room=(await client.get('/api/v1/chat/messages',headers=headers)).json();msg=next(x for x in room['messages'] if x['id']==mid)
    assert msg['deleted'] and msg['text'] is None and not room['pins']
    assert (await client.post('/api/v1/chat/moderation',headers=admin,json={'action':'set_moderator','target_id':str(uid),'reason':'QA модератор'})).status_code==200
    async with session_factory() as db:
        row=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==uid));row.trial_ends_at=s.now()-timedelta(seconds=1);await db.commit()
    assert (await client.get('/api/v1/chat/messages',headers=headers)).status_code==403
    assert (await client.post('/api/v1/chat/messages',headers=headers,json={'request_id':str(uuid4()),'text':'недоступно'})).status_code==403
    assert (await client.get('/api/v1/chat/messages',headers=admin)).status_code==200

@pytest.mark.asyncio
async def test_chat_sanction_survives_access_restore(platform,client,session_factory,admin_token):
    await enable(session_factory);admin={'Authorization':'Bearer '+admin_token}
    async with session_factory() as db:
        user,headers=await create_actor(db,'supplier');await s.activate_trial(db,user,'quarry');await db.commit();uid=user.id
    for action,expected in [('ban',403),('unban',200),('remove',403),('restore',200)]:
        assert (await client.post('/api/v1/chat/moderation',headers=admin,json={'action':action,'target_id':str(uid),'reason':'QA ограничение'})).status_code==200
        assert (await client.get('/api/v1/chat/messages',headers=headers)).status_code==expected
    response=await client.post('/api/v1/chat/moderation',headers=admin,json={'action':'mute','target_id':str(uid),'reason':'QA пауза','until':(s.now()+timedelta(minutes=1)).isoformat()});assert response.status_code==200
    assert (await client.get('/api/v1/chat/messages',headers=headers)).status_code==200
    assert (await client.post('/api/v1/chat/messages',headers=headers,json={'request_id':str(uuid4()),'text':'QA'})).status_code==403

@pytest.mark.asyncio
async def test_journey_anonymous_idempotence_privacy_and_link(platform,client,session_factory,admin_token):
    await enable(session_factory)
    sid,vid,aid,eid=uuid4(),uuid4(),uuid4(),uuid4()
    event={'id':str(eid),'session_id':str(sid),'visitor_id':str(vid),'attempt_id':str(aid),'kind':'auth','event':'auth_started','occurred_at':s.now().isoformat(),'details':{'screen':'login'}}
    for _ in range(2):
        response=await client.post('/api/v1/telemetry/events',json={'events':[event]});assert response.status_code==200,response.text
    response=await client.post('/api/v1/telemetry/events',json={'events':[{**event,'id':str(uuid4()),'event':'auth_succeeded'}]});assert response.status_code==422
    response=await client.post('/api/v1/telemetry/events',json={'events':[{**event,'id':str(uuid4()),'details':{'token':'secret'}}]});assert response.status_code==422
    async with session_factory() as db:
        assert len((await db.scalars(select(JourneyEvent).where(JourneyEvent.id==eid))).all())==1
        user,headers=await create_actor(db,'supplier');await db.commit()
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='auth',event='auth_failed',source='server',contact='+79990000001',state='failed',details={'error_code':'OTP_INVALID','password':'should-not-store'})
        await db.commit()
        row=await db.get(JourneyAttempt,aid);assert '+7999' not in row.contact_cipher
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='auth',event='auth_succeeded',source='server',actor=('user',user.id),state='succeeded');await db.commit()
    admin={'Authorization':'Bearer '+admin_token}
    detail=await client.get('/api/v1/admin/journeys/'+str(sid),headers=admin);assert detail.status_code==200,detail.text
    value=detail.json();assert value['session']['actor_id']==str(user.id) and value['attempts'][0]['state']=='succeeded'
    assert value['attempts'][0]['contact']!='+79990000001';assert 'should-not-store' not in detail.text
    assert all(x['resolved'] for x in value['incidents'])
    assert (await client.get('/api/v1/admin/journeys/'+str(sid),headers=headers)).status_code==403
    contact=await client.get('/api/v1/admin/journey-attempts/'+str(aid)+'/contact',headers=admin);assert contact.json()['contact']=='+79990000001'

@pytest.mark.asyncio
async def test_pending_not_failed_and_late_success_resolves(platform,session_factory):
    await enable(session_factory)
    async with session_factory() as db:
        sid,vid,aid=uuid4(),uuid4(),uuid4()
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='subscription',event='subscription_payment_pending',source='server',state='pending')
        row=await db.get(JourneyAttempt,aid);row.last_at=s.now()-timedelta(hours=2);await db.commit()
        await j.maintenance(db);await db.commit();await db.refresh(row)
        assert row.abandoned and row.state=='pending'
        await j.record(db,event_id=uuid4(),session_id=sid,visitor_id=vid,attempt_id=aid,kind='subscription',event='subscription_payment_succeeded',source='worker',state='succeeded');await db.commit()
        assert not row.abandoned and row.state=='succeeded'

@pytest.mark.asyncio
async def test_message_cursor_does_not_skip_bursts_larger_than_one_page(platform,client,session_factory,admin_token):
    await enable(session_factory)
    async with session_factory() as db:
        author,_=await create_actor(db,'admin')
        messages=[ChatMessage(account_id=author.id,request_id=uuid4(),text='QA burst '+str(i)) for i in range(75)]
        db.add_all(messages);await db.commit();ids=[x.id for x in messages]
    headers={'Authorization':'Bearer '+admin_token}
    first=(await client.get('/api/v1/chat/messages',headers=headers,params={'after':ids[0]-1})).json()['messages']
    assert [x['id'] for x in first]==ids[:50]
    second=(await client.get('/api/v1/chat/messages',headers=headers,params={'after':first[-1]['id']})).json()['messages']
    assert [x['id'] for x in second]==ids[50:]
