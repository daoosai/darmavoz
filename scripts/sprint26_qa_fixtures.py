"""Disposable QA only. Reproducible browser fixtures; tokens remain outside git.

Run in s26_qa_backend, then copy /tmp/s26-qa-auth.json to the node /tmp privately.
This script is deliberately forbidden on runtime test/production databases.
"""
import asyncio,json,os
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.engine import make_url
from app.db.database import AsyncSessionLocal
from app.core.config import settings
from app.models.models import User,Role,City,Category,Material,Client,Order,OrderItem,Driver,Vehicle
from app.models.subscriptions import SprintSetting,SubscriptionPlan
from app.security.jwt import create_access_token

async def main():
    if make_url(str(settings.DATABASE_URL)).database!='s26qa' or not settings.PAYMENT_TEST_MODE or settings.YOOKASSA_SHOP_ID!='isolated-qa':
        raise RuntimeError('DISPOSABLE_QA_ONLY')
    async with AsyncSessionLocal() as db:
        row=await db.get(SprintSetting,'platform')
        values={'enabled':True,'direct_orders':True,'water_paid_only':True,'chat_enabled':True,'journey_enabled':True,'owner_id':None,'notify_push':False,'notify_inapp':False}
        if not row:row=SprintSetting(key='platform',value=values);db.add(row)
        else:row.value=values
        admin=await db.scalar(select(User).where(User.username==settings.ADMIN_USERNAME));admin.display_name='QA администратор'
        result={'admin':{'token':create_access_token({'sub':admin.username,'role':'admin'}),'role':'admin','id':str(admin.id)}}
        labels={'supplier':'Поставщик','driver':'Водитель','equipment_owner':'Спецтехника','water_septic_partner':'Вода и септики'}
        for name,label in labels.items():
            role=await db.scalar(select(Role).where(Role.name==name))
            if not role:role=Role(name=name,description=name);db.add(role);await db.flush()
            user=User(username='s26-qa-'+uuid4().hex[:24],display_name='QA '+label,hashed_password='not-a-login-password',role_id=role.id,is_active=True)
            db.add(user);await db.flush()
            result[name]={'token':create_access_token({'sub':user.username,'role':name}),'role':name,'id':str(user.id)}
            if name=='driver':
                vehicle=Vehicle(title='QA машина',brand='QA',plate_number='А'+str(100+int(uuid4().hex[:3],16)%900)+'ВС772',moderation_status='approved',is_active=True)
                db.add(vehicle);await db.flush()
                driver=Driver(user_id=user.id,name='QA водитель',phone='+7999'+str(int(uuid4().hex[:5],16)).zfill(7)[-7:],vehicle_id=vehicle.id,moderation_status='approved',is_active=True)
                db.add(driver);await db.flush();result[name]['driverId']=str(driver.id)
        city=await db.scalar(select(City).where(City.code=='tyumen'));result['city_id']=str(city.id)
        for category in ['quarry','accumulator','driver','carrier','equipment','water','firewood','septic']:
            if not await db.scalar(select(SubscriptionPlan.id).where(SubscriptionPlan.category==category,SubscriptionPlan.test_only.is_(True),SubscriptionPlan.published.is_(True)).limit(1)):
                db.add(SubscriptionPlan(category=category,name='QA тестовый тариф '+category,months=1,amount=1,published=True,test_only=True))
        cat=Category(name='QA материалы',slug='s26-qa-'+uuid4().hex,is_active=True);db.add(cat);await db.flush()
        material=Material(category_id=cat.id,name='QA Бой кирпича',description='Тестовые данные',price=1,unit='м³',min_volume=1,is_active=True);db.add(material);await db.flush()
        customer=Client(name='QA клиент',email=uuid4().hex+'@example.invalid');db.add(customer);await db.flush()
        order=Order(client_id=customer.id,city_id=city.id,status='delivered',settlement_mode='direct',total_amount=10,delivery_cost=0,address='Тестовый адрес',delivery_address='Тестовый адрес',source='qa');db.add(order);await db.flush()
        db.add(OrderItem(order_id=order.id,material_id=material.id,quantity=1,volume=10,price=1,amount=10))
        result['client']={'token':create_access_token({'sub':customer.email,'role':'client','client_id':str(customer.id)}),'role':'client','id':str(customer.id),'order_id':str(order.id)}
        await db.commit()
        with open('/tmp/s26-qa-auth.json','w') as file:json.dump(result,file)
        os.chmod('/tmp/s26-qa-auth.json',0o600)
    print('Fresh isolated QA fixtures written privately; tokens not printed')

if __name__=='__main__':asyncio.run(main())
