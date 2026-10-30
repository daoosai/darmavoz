"""Explicit, audited transition; existing dates are copied, never restarted."""
from sqlalchemy import select,func
from sqlalchemy.dialects.postgresql import insert
from app.models.models import Quarry,SpecialEquipmentListing,User,Vehicle,Driver
from app.models.subscriptions import AccessGrant,CategoryAccess,TrialIdentity,SprintSetting,VehicleMembership
from app.services import subscriptions as s

async def preview(db):
    result=[]
    for model,kind in [(Quarry,'pickup_point'),(SpecialEquipmentListing,'equipment')]:
        for item in (await db.scalars(select(model).order_by(model.id))).all():
            ends=[x for x in [item.placement_ends_at,item.trial_ends_at,getattr(item,'subscription_end_date',None)] if x]
            end=max(ends) if ends else None
            result.append({'id':str(item.id),'type':kind,'category':s.point_category(item) if kind=='pickup_point' else 'equipment',
                'owner_id':str(item.owner_user_id) if item.owner_user_id else None,'starts_at':(item.placement_started_at or item.created_at).isoformat(),
                'ends_at':end.isoformat() if end else None,'trial_ends_at':item.trial_ends_at.isoformat() if item.trial_ends_at else None,
                'needs_review':end is None,'active_now':bool(end and end>s.now())})
    return result

async def apply(db,actor_id):
    await db.execute(select(func.pg_advisory_xact_lock(260029)))
    items=await preview(db);copied=0
    from datetime import datetime
    from uuid import UUID
    for item in items:
        key=f"legacy:{item['type']}:{item['id']}"
        owner=await db.get(User,UUID(item['owner_id'])) if item['owner_id'] else None
        if item['ends_at'] and not await db.scalar(select(AccessGrant.id).where(AccessGrant.source_key==key)):
            start=datetime.fromisoformat(item['starts_at']);end=datetime.fromisoformat(item['ends_at'])
            if end>start:
                db.add(AccessGrant(account_id=owner.id if owner else None,category=item['category'],resource_type=item['type'],
                    resource_id=UUID(item['id']),source='legacy',source_key=key,starts_at=start,ends_at=end));copied+=1
        if owner and item['trial_ends_at']:
            row=await s.account_category(db,owner.id,item['category'],lock=True)
            end=datetime.fromisoformat(item['trial_ends_at']);start=datetime.fromisoformat(item['starts_at'])
            if row.trial_started_at is None:
                row.trial_started_at=start;row.trial_ends_at=end
                for value in {owner.username,owner.email}-{None,''}:
                    await db.execute(insert(TrialIdentity).values(category=item['category'],identity_key=s.identity_key(value),account_id=owner.id,started_at=start).on_conflict_do_nothing())
    invalid=[]
    for vehicle in (await db.scalars(select(Vehicle))).all():
        try:vehicle.plate_key=s.plate_key(vehicle.plate_number)
        except Exception:invalid.append(str(vehicle.id))
    for driver in (await db.scalars(select(Driver).where(Driver.vehicle_id.is_not(None),Driver.user_id.is_not(None)))).all():
        await db.execute(insert(VehicleMembership).values(account_id=driver.user_id,vehicle_id=driver.vehicle_id).on_conflict_do_nothing())
    s.audit(db,actor_id,None,'legacy_transition',resources=len(items),grants=copied,unconfirmed=sum(x['needs_review'] for x in items),invalid_plates=invalid)
    row=await db.get(SprintSetting,'transition')
    if not row:row=SprintSetting(key='transition',value={});db.add(row)
    row.value={'at':s.now().isoformat(),'resources':len(items),'invalid_plates':invalid}
    await db.flush()
    return {'resources':len(items),'copied_grants':copied,'needs_review':[x for x in items if x['needs_review']],'invalid_vehicle_ids':invalid}
