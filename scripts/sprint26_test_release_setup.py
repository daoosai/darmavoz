"""Explicit test-runtime setup. No production, .env changes or real messages.

Creates dedicated QA actors/resources and test-only plans, preserves original access dates.
JWT fixtures are private outside git; stdout contains only IDs/counts/feature flags.
"""
import argparse,asyncio,json,os,secrets
from pathlib import Path
from sqlalchemy import select,text,or_
from sqlalchemy.dialects.postgresql import insert
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import (User,Role,City,Category,Material,Client,Order,OrderItem,Driver,Vehicle,Quarry,
    WaterPoint,SepticProviderProfile,SpecialEquipmentListing,DeliveryOption,DeliveryTariff,TransportCategory,
    driver_cities,user_cities,quarry_materials)
from app.models.subscriptions import SprintSetting,SubscriptionPlan
from app.services import subscriptions as s,subscription_transition
from app.security.auth import get_password_hash
from app.security.jwt import create_access_token

ROOT=Path('/opt/darmavoz_test_backups/sprint26')

async def run(args):
    if not settings.PAYMENT_TEST_MODE or not settings.YOOKASSA_SECRET_KEY.startswith('test_'):
        raise RuntimeError('TEST_SHOP_REQUIRED')
    async with AsyncSessionLocal() as db:
        if db.bind.url.database!='darmavoz_test':raise RuntimeError('TEST_RUNTIME_ONLY')
        revision=await db.scalar(text('SELECT version_num FROM alembic_version'))
        if revision!='s26_subscription_platform':raise RuntimeError('SPRINT26_SCHEMA_NOT_INSTALLED')
        await db.execute(select(__import__('sqlalchemy').func.pg_advisory_xact_lock(260031)))
        city=await db.scalar(select(City).where(City.code=='tyumen'))
        if not city:raise RuntimeError('TYUMEN_REQUIRED')
        previous=json.loads((ROOT/'qa-auth.json').read_text()) if (ROOT/'qa-auth.json').exists() else {}
        result={**previous,'city_id':str(city.id)};users={}
        for role_name in ['admin','logist','driver','supplier','equipment_owner','water_septic_partner']:
            role=await db.scalar(select(Role).where(Role.name==role_name))
            if not role:raise RuntimeError('EXISTING_ROLE_REQUIRED: '+role_name)
            username='s26-qa-release-'+role_name
            user=await db.scalar(select(User).where(User.username==username))
            password=None
            if not user:
                password=secrets.token_urlsafe(40)
                user=User(username=username,display_name='QA Спринт 26 · '+role_name,email=username+'@example.invalid',
                    hashed_password=get_password_hash(password),role_id=role.id,is_active=True)
                db.add(user);await db.flush()
            user.role=role;users[role_name]=user
            await db.execute(insert(user_cities).values(user_id=user.id,city_id=city.id).on_conflict_do_nothing())
            result[role_name]={'id':str(user.id),'role':role_name,'token':create_access_token({'sub':username,'role':role_name})}
            password=password or previous.get(role_name,{}).get('password')
            if password:result[role_name]['password']=password
        if not await db.get(SprintSetting,'transition'):
            transfer=await subscription_transition.apply(db,users['admin'].id)
            transition={'resources':transfer['resources'],'copied_grants':transfer['copied_grants'],'needs_review':len(transfer['needs_review']),'invalid_vehicles':len(transfer['invalid_vehicle_ids'])}
        else:transition={'skipped_existing':True}
        await s.seed_plans(db)
        result['plans']={}
        for category,(label,_) in s.CATEGORIES.items():
            result['plans'][category]={}
            for months in [1,3,6,12]:
                name=f'QA Sprint 26 · {label} · {months} мес. (тест)'
                plan=await db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.name==name,SubscriptionPlan.test_only.is_(True)))
                if not plan:
                    plan=SubscriptionPlan(category=category,name=name,months=months,amount=1,published=True,test_only=True);db.add(plan);await db.flush()
                result['plans'][category][str(months)]=str(plan.id)
        category=await db.scalar(select(Category).where(Category.slug=='s26-qa'))
        if not category:category=Category(name='QA Спринт 26',slug='s26-qa',is_active=True);db.add(category);await db.flush()
        material=await db.scalar(select(Material).where(Material.category_id==category.id,Material.name=='QA Бой кирпича С26'))
        if not material:
            material=Material(category_id=category.id,name='QA Бой кирпича С26',description='Только тестовые данные Спринта 26',unit='м³',price=1,min_volume=1,is_active=True);db.add(material);await db.flush()
        result['material_id']=str(material.id)
        wood_category=await db.scalar(select(Category).where(or_(Category.slug=='firewood',Category.name.ilike('%дров%'))).limit(1))
        if not wood_category:
            wood_category=Category(name='Дрова',slug='firewood',is_active=True);db.add(wood_category);await db.flush()
        wood=await db.scalar(select(Material).where(Material.category_id==wood_category.id,Material.name=='QA Дрова С26'))
        if not wood:
            wood=Material(category_id=wood_category.id,name='QA Дрова С26',description='Только тестовые данные Спринта 26',unit='м³',price=1,min_volume=1,is_active=True);db.add(wood);await db.flush()
        result['firewood_material_id']=str(wood.id)
        options=await db.execute(select(DeliveryTariff,TransportCategory).join(TransportCategory,TransportCategory.id==DeliveryTariff.transport_category_id).where(
            DeliveryTariff.city_id==city.id,DeliveryTariff.is_active.is_(True),DeliveryTariff.distance_from_km==0,DeliveryTariff.distance_to_km.is_(None),
            DeliveryTariff.rate_per_km==0,DeliveryTariff.min_price_quarry==0,DeliveryTariff.min_price_warehouse==0))
        tariff=options.first()
        if not tariff:raise RuntimeError('EXISTING_ZERO_TEST_TARIFF_REQUIRED')
        transport=tariff[1]
        option=await db.scalar(select(DeliveryOption).where(DeliveryOption.title=='QA Спринт 26 · 20 м³'))
        if not option:
            option=DeliveryOption(title='QA Спринт 26 · 20 м³',capacity_m3=20,transport_category_id=transport.id,base_price=0,is_active=True);db.add(option);await db.flush()
        result['delivery_option_id']=str(option.id)
        driver=await db.scalar(select(Driver).where(Driver.user_id==users['driver'].id))
        if not driver:
            plate='А926КС999'
            if await db.scalar(select(Vehicle.id).where(Vehicle.plate_key==s.plate_key(plate))):raise RuntimeError('QA_PLATE_COLLISION_REVIEW')
            vehicle=Vehicle(title='QA Спринт 26',brand='QA',plate_number=plate,delivery_option_id=option.id,transport_category_id=transport.id,
                body_volume_m3=20,is_active=True,moderation_status='approved');db.add(vehicle);await db.flush()
            driver=Driver(user_id=users['driver'].id,vehicle_id=vehicle.id,name='QA Спринт 26',phone='+70000000026',is_active=True,moderation_status='approved',
                status='available',is_on_shift=True,is_dispatch_eligible=True,is_auto_dispatch_enabled=True,last_lat=57.15,last_lon=65.53,last_location_updated_at=s.now())
            db.add(driver);await db.flush()
        await db.execute(insert(driver_cities).values(driver_id=driver.id,city_id=city.id).on_conflict_do_nothing())
        result['driver'].update(driverId=str(driver.id),vehicle_id=str(driver.vehicle_id))
        result['points']={}
        for kind,label in [('quarry','Карьер'),('accumulator','Накопитель'),('supplier','Дрова')]:
            name='QA Спринт 26 · '+label
            point=await db.scalar(select(Quarry).where(Quarry.owner_user_id==users['supplier'].id,Quarry.name==name))
            if not point:
                point=Quarry(city_id=city.id,owner_user_id=users['supplier'].id,name=name,short_name=name,point_type=kind,address='Тюмень, тестовая точка С26',
                    lat=57.15,lon=65.53,contact_phone='+70000000026',is_active=True,moderation_status='approved',placement_status='active',crm_status='activated')
                db.add(point);await db.flush()
            offered_material=wood if kind=='supplier' else material
            await db.execute(insert(quarry_materials).values(quarry_id=point.id,material_id=offered_material.id,price=1,is_active=True).on_conflict_do_nothing())
            result['points'][kind]=str(point.id)
        water=await db.scalar(select(WaterPoint).where(WaterPoint.owner_user_id==users['water_septic_partner'].id))
        if not water:
            water=WaterPoint(owner_user_id=users['water_septic_partner'].id,city_id=city.id,water_type='paid',is_free=False,name='QA Спринт 26 · платная вода',
                source='QA поставщик',address='Тюмень, тестовая точка С26',lat=57.15,lon=65.53,phone='+70000000026',price=1,price_unit='1 м³',
                is_active=True,moderation_status='approved',crm_status='activated');db.add(water);await db.flush()
        septic=await db.scalar(select(SepticProviderProfile).where(SepticProviderProfile.owner_user_id==users['water_septic_partner'].id))
        if not septic:
            septic=SepticProviderProfile(owner_user_id=users['water_septic_partner'].id,city_id=city.id,phone='+70000000026',address='Тюмень, тестовая точка С26',
                lat=57.15,lon=65.53,tank_volume_m3=3,service_price=1,moderation_status='approved',is_active=True);db.add(septic);await db.flush()
        equipment=await db.scalar(select(SpecialEquipmentListing).where(SpecialEquipmentListing.owner_user_id==users['equipment_owner'].id))
        if not equipment:
            equipment=SpecialEquipmentListing(owner_user_id=users['equipment_owner'].id,created_by_user_id=users['equipment_owner'].id,city_id=city.id,
                equipment_type='Экскаватор',title='QA Спринт 26 · спецтехника',description='Только тестовые данные',contact_phone='+70000000026',
                tariffs=[{'type':'hour','price':1}],price_from=1,city='Тюмень',is_active=True,moderation_status='approved',placement_status='active')
            db.add(equipment);await db.flush()
        result.update(water_id=str(water.id),septic_id=str(septic.id),equipment_id=str(equipment.id))
        customer=await db.scalar(select(Client).where(Client.email=='s26-qa-checkout@example.invalid'))
        if not customer:customer=Client(name='QA покупатель Спринт 26',email='s26-qa-checkout@example.invalid');db.add(customer);await db.flush()
        if not customer.phone:customer.phone='+70000000027'
        review=await db.scalar(select(Order).where(Order.client_id==customer.id,Order.source=='s26-qa-review'))
        if not review:
            review=Order(client_id=customer.id,city_id=city.id,status='delivered',settlement_mode='direct',total_amount=10,delivery_cost=0,
                address='Тюмень, тестовый адрес С26',delivery_address='Тюмень, тестовый адрес С26',source='s26-qa-review');db.add(review);await db.flush()
            db.add(OrderItem(order_id=review.id,material_id=material.id,quantity=1,volume=10,price=1,amount=10))
        result['client']={'id':str(customer.id),'role':'client','order_id':str(review.id),'token':create_access_token({'sub':customer.email,'role':'client','client_id':str(customer.id)})}
        if args.enable:
            row=await db.get(SprintSetting,'platform')
            values={**(row.value if row else {}),'enabled':True,'direct_orders':True,'water_paid_only':True,'chat_enabled':True,'journey_enabled':True,
                'owner_id':str(users['admin'].id),'notify_inapp':True,'notify_push':True,'notify_abandoned':False}
            if not row:row=SprintSetting(key='platform',value=values);db.add(row)
            else:row.value=values
            s.audit(db,users['admin'].id,None,'test_release_enabled',flags=['enabled','direct_orders','water_paid_only','chat_enabled','journey_enabled'])
        await db.commit()
        ROOT.mkdir(parents=True,exist_ok=True,mode=0o700);path=ROOT/'qa-auth.json';path.write_text(json.dumps(result));os.chmod(path,0o600)
        print(json.dumps({'database':'darmavoz_test','schema':revision,'features_enabled':args.enable,'qa_roles':list(users),'test_plans':32,
            'transition':transition,'fixtures_private':str(path),'points':result['points'],'water_id':str(water.id),'septic_id':str(septic.id),'equipment_id':str(equipment.id)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--enable',action='store_true');asyncio.run(run(parser.parse_args()))
