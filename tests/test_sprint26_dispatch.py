"""Current city/category fixtures verify existing dispatch with subscription admission."""
from datetime import timedelta
from uuid import uuid4
import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.config import settings
from app.models.models import City,TransportCategory,DeliveryOption,Client,Order,Driver,OrderOffer,driver_cities
from app.models.subscriptions import CategoryAccess
from app.services import dispatch_service as d,subscriptions as s
from tests.test_sprint26_subscriptions import platform,create_actor

@pytest.mark.asyncio
@pytest.mark.parametrize('decision',['decline','timeout'])
async def test_offer_handoff_keeps_120_seconds_and_excludes_expired_access(platform,client,session_factory,monkeypatch,decision):
    monkeypatch.setattr(settings,'DISPATCH_OFFER_TIMEOUT_SECONDS',120)
    monkeypatch.setattr(d,'schedule_logist_timeout_notification',lambda *args:None)
    async with session_factory() as db:
        city=await db.scalar(select(City).where(City.code=='tyumen'));category=await db.scalar(select(TransportCategory).where(TransportCategory.slug=='small'))
        option=DeliveryOption(title='QA current dispatch 5',capacity_m3=5,transport_category_id=category.id,base_price=0,is_active=True);db.add(option);await db.flush()
        actors=[]
        for i in range(3):
            user,headers=await create_actor(db,'driver');driver=user.driver_profile
            driver.vehicle.plate_number='А'+str(100+int(uuid4().hex[:3],16)%900)+['МН','ХТ','КС'][i]+'198'
            driver.vehicle.delivery_option_id=option.id;driver.vehicle.transport_category_id=category.id;driver.vehicle.body_volume_m3=5
            driver.status='available';driver.is_on_shift=True;driver.is_dispatch_eligible=True;driver.is_auto_dispatch_enabled=True;driver.dispatch_priority=100-i
            await db.execute(driver_cities.insert().values(driver_id=driver.id,city_id=city.id))
            if i<2:await s.activate_trial(db,user,'driver')
            actors.append((user.id,driver.id,headers))
        _,logist=await create_actor(db,'logist')
        customer=Client(name='QA dispatch only',email=uuid4().hex+'@example.invalid');db.add(customer);await db.flush()
        # Historical orders without coordinates must keep the established fallback dispatch.
        order=Order(client_id=customer.id,city_id=city.id,delivery_option_id=option.id,transport_category_id=category.id,status='searching_driver',total_amount=10,settlement_mode='direct');db.add(order);await db.commit();oid=order.id
    denied=await client.post(f'/api/v1/orders/{oid}/assign',headers=logist,json={'driver_id':str(actors[2][1])})
    assert denied.status_code==409 and denied.json()['code']=='DRIVER_SUBSCRIPTION_REQUIRED',denied.text
    async with session_factory() as db:
        order=await d.get_order_by_id(db,oid)
        candidates=await d.get_matching_drivers(db,order)
        assert {x.id for x in candidates}=={actors[0][1],actors[1][1]}
        await d.advance_dispatch_for_order(db,oid);await db.commit()
        order=await d.get_order_by_id(db,oid);first=order.current_offer
        assert first.driver_id==actors[0][1] and first.expires_at-first.offered_at==timedelta(seconds=120);first_id=first.id
        trial=await db.scalar(select(CategoryAccess).where(CategoryAccess.account_id==actors[0][0],CategoryAccess.category=='driver'))
        trial.trial_ends_at=s.now()-timedelta(seconds=1);await db.commit()
    denied=await client.post(f'/api/v1/driver/order-offers/{first_id}/accept',headers=actors[0][2])
    assert denied.status_code==409 and denied.json()['code']=='DRIVER_SUBSCRIPTION_REQUIRED',denied.text
    async with session_factory() as db:
        if decision=='decline':
            result=await d.decline_offer(db,offer_id=first_id,driver_id=actors[0][1],reason='QA refusal')
        else:
            offer=await db.scalar(select(OrderOffer).options(selectinload(OrderOffer.driver),selectinload(OrderOffer.order)).where(OrderOffer.id==first_id))
            offer.expires_at=s.now()-timedelta(seconds=1);await db.flush()
            result=await d.expire_offer(db,offer)
        await db.commit();result=await d.get_order_by_id(db,oid)
        assert result.current_offer.driver_id==actors[1][1]
        assert result.current_offer.expires_at-result.current_offer.offered_at==timedelta(seconds=120)
        assert result.current_offer.sequence_no==2
