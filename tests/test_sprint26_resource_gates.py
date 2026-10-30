from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from app.models.models import City,Quarry,Category,Material,DeliveryOption,Client,Driver,Order,WaterPoint,SepticProviderProfile,driver_cities,quarry_materials,TransportCategory
from app.models.subscriptions import AccessGrant,SprintSetting
from app.services import subscriptions as s,dispatch_service as dispatch
from app.services.pickup_points import pickup_point_orderable
from app.services.dispatch_admission import admit_driver
from app.services.order_pricing import calculate_client_order_pricing
from tests.test_sprint26_subscriptions import platform,create_actor

@pytest.mark.asyncio
async def test_expired_point_stays_on_map_but_cannot_be_ordered(platform,client,session_factory):
    async with session_factory() as db:
        owner,_=await create_actor(db,'supplier');city=await db.scalar(select(City).where(City.code=='tyumen'))
        point=Quarry(name='QA expired storage',address='QA address',city_id=city.id,point_type='accumulator',lat=57.1,lon=65.5,
            owner_user_id=owner.id,contact_phone='+79990000002',description='Contact +79990000002',parsed_data={'phones':['+79990000002']},
            crm_status='activated',moderation_status='approved',placement_status='expired',is_active=False,
            placement_started_at=s.now()-timedelta(days=30),placement_ends_at=s.now()-timedelta(days=1))
        category=Category(name='QA material',slug=uuid4().hex);db.add(category);await db.flush()
        material=Material(category_id=category.id,name='QA bricks',description='',unit='m3',price=1,min_volume=1,is_active=True);db.add_all([point,material]);await db.flush()
        await db.execute(quarry_materials.insert().values(quarry_id=point.id,material_id=material.id,price=1,is_active=True))
        option=DeliveryOption(title='QA 10 m3',capacity_m3=10,base_price=0,is_active=True);db.add(option);await db.commit()
        ids=(str(point.id),str(city.id),str(material.id),owner.id)
        assert not await pickup_point_orderable(db,point)
        with pytest.raises(HTTPException) as error:
            await calculate_client_order_pricing(db,material_id=material.id,delivery_option_id=option.id,delivery_lat=57.15,delivery_lon=65.55,city_id=city.id,quarry_id=point.id)
        assert error.value.status_code==404
    pid,cid,mid,uid=ids
    response=await client.get('/api/v1/pickup-points/global',params={'city_id':cid});assert response.status_code==200,response.text
    row=next(x for x in response.json() if x['id']==pid);assert not row['can_order'] and not row['is_ready'] and row['contact_phone'] is None and row['parsed_data'] is None
    detail=await client.get('/api/v1/pickup-points/'+pid,params={'city_id':cid,'material_id':mid});assert detail.status_code==200,detail.text
    assert '+79990000002' not in detail.text
    async with session_factory() as db:
        db.add(AccessGrant(account_id=uid,category='accumulator',source='admin',source_key='qa:'+uuid4().hex,starts_at=s.now()-timedelta(seconds=1),ends_at=s.now()+timedelta(days=1)));await db.commit()
        assert await pickup_point_orderable(db,await db.get(Quarry,pid))
    row=next(x for x in (await client.get('/api/v1/pickup-points/global',params={'city_id':cid})).json() if x['id']==pid)
    assert row['can_order'] and row['is_ready'] and row['contact_phone']

@pytest.mark.asyncio
async def test_public_water_and_septic_hide_contacts_only_for_public(platform,client,session_factory):
    async with session_factory() as db:
        owner,headers=await create_actor(db,'water_septic_partner');city=await db.scalar(select(City).where(City.code=='tyumen'))
        water=WaterPoint(owner_user_id=owner.id,city_id=city.id,water_type='paid',name='QA seller',source='QA',address='QA address',lat=57.1,lon=65.5,
            phone='+79990000003',price=10,price_unit='100 л',is_free=False,description='QA +79990000003',crm_status='activated',moderation_status='approved',is_active=True)
        septic=SepticProviderProfile(owner_user_id=owner.id,city_id=city.id,phone='+79990000003',address='QA address',lat=57.1,lon=65.5,
            tank_volume_m3=3,service_price=10,moderation_status='approved',is_active=True)
        db.add_all([water,septic]);await db.commit();wid,sid,cid=str(water.id),str(septic.id),str(city.id)
    for path,oid in [('/water-points',wid),('/septic-providers',sid)]:
        response=await client.get('/api/v1'+path,params={'city_id':cid});assert response.status_code==200,response.text
        row=next(x for x in response.json() if x['id']==oid);assert row['phone'] is None and not row['can_order']
    response=await client.get('/api/v1/water-septic-partner/water-points',headers=headers)
    assert response.status_code==200,response.text
    assert next(x for x in response.json() if x['id']==wid)['phone']=='+79990000003'

@pytest.mark.asyncio
async def test_new_admission_denied_but_assigned_trip_completes_after_expiry(platform,client,session_factory,monkeypatch):
    for name in ['schedule_client_heading_to_pickup_status_notification','schedule_client_heading_to_client_status_notification','schedule_client_completed_status_notification']:
        monkeypatch.setattr(dispatch,name,lambda *a,**kw:None)
    async with session_factory() as db:
        user,headers=await create_actor(db,'driver');driver=user.driver_profile
        city=await db.scalar(select(City).where(City.code=='tyumen'));tc=await db.scalar(select(TransportCategory).where(TransportCategory.slug=='small'))
        option=DeliveryOption(title='QA 5 m3',capacity_m3=5,transport_category_id=tc.id,base_price=0,is_active=True);db.add(option);await db.flush()
        driver.vehicle.delivery_option_id=option.id;driver.vehicle.transport_category_id=tc.id;driver.vehicle.body_volume_m3=5
        driver.vehicle.plate_number='А987ВС72';driver.status='available';driver.is_on_shift=True
        await db.execute(driver_cities.insert().values(driver_id=driver.id,city_id=city.id))
        customer=Client(name='QA receipt',email=uuid4().hex+'@example.invalid');db.add(customer);await db.flush()
        order=Order(client_id=customer.id,city_id=city.id,delivery_option_id=option.id,transport_category_id=tc.id,status='created',total_amount=10,settlement_mode='direct');db.add(order);await db.commit()
        with pytest.raises(HTTPException) as denied:await admit_driver(db,order,driver.id,automatic=False)
        assert denied.value.detail['code']=='DRIVER_SUBSCRIPTION_REQUIRED'
        assert not (await client.get('/api/v1/subscriptions/me',headers=headers)).json()['transport_access']
        await s.activate_trial(db,user,'driver');await db.commit()
        assert (await admit_driver(db,order,driver.id,automatic=False)).id==driver.id
        assert (await client.get('/api/v1/subscriptions/me',headers=headers)).json()['transport_access']
        from app.models.subscriptions import CategoryAccess
        row=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==user.id,CategoryAccess.category=='driver'))
        row.trial_ends_at=s.now()-timedelta(seconds=1);order.driver_id=driver.id;order.status='driver_assigned';await db.commit()
        for status in ['heading_to_pickup','arrived_at_pickup','loading','heading_to_client','delivered','completed']:
            order=await dispatch.set_driver_order_status(db,order_id=order.id,driver_id=driver.id,target_status=status)
            assert order.status==status
        assert driver.status=='available'

@pytest.mark.asyncio
async def test_no_driver_retry_is_due_and_does_not_repeat_notification(platform,session_factory,monkeypatch):
    notices=[];monkeypatch.setattr(dispatch,'schedule_logist_no_driver_found_notification',lambda order:notices.append(order.id))
    async with session_factory() as db:
        customer=Client(name='QA retry',email=uuid4().hex+'@example.invalid');db.add(customer);await db.flush()
        order=Order(client_id=customer.id,status='searching_driver',total_amount=1);db.add(order);await db.flush()
        await dispatch.mark_no_driver_found(db,order);await db.commit()
        assert order.next_dispatch_at>s.now() and len(notices)==1
        assert order.id not in await dispatch.get_orders_needing_dispatch(db)
        order.next_dispatch_at=s.now()-timedelta(seconds=1);await db.commit()
        assert order.id in await dispatch.get_orders_needing_dispatch(db)
        await dispatch.mark_no_driver_found(db,order);assert len(notices)==1
