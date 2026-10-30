"""Verify S26 up/down on a private test backup clone, without application workers.

Hard-coded disposable DB name prevents running a destructive downgrade on runtime.
Only counts/digests are printed; no contacts, tokens or historical payment bodies.
"""
import asyncio,json,subprocess
from sqlalchemy import text,select
from app.db.database import AsyncSessionLocal
from app.models.models import User,Role
from app.services import subscription_transition

TABLES=['orders','order_items','users','vehicles','water_points','media_files','payments','payment_events','payment_refunds']

async def snapshot():
    async with AsyncSessionLocal() as db:
        if db.bind.url.database!='s26_migration_test':raise RuntimeError('DISPOSABLE_MIGRATION_CLONE_ONLY')
        result={}
        for table in TABLES:
            row=(await db.execute(text(f"SELECT count(*), md5(string_agg(md5((to_jsonb(t)-'settlement_mode'-'next_dispatch_at'-'plate_key')::text),'' ORDER BY t.id)) FROM {table} t"))).one()
            result[table]={'count':row[0],'digest':row[1]}
        return result

async def transition():
    async with AsyncSessionLocal() as db:
        if db.bind.url.database!='s26_migration_test':raise RuntimeError('DISPOSABLE_MIGRATION_CLONE_ONLY')
        actor=await db.scalar(select(User.id).join(Role).where(Role.name=='admin').limit(1))
        result=await subscription_transition.apply(db,actor);await db.commit()
        repeat=await subscription_transition.apply(db,actor);await db.commit()
        assert repeat['copied_grants']==0
        return {'resources':result['resources'],'copied_grants':result['copied_grants'],
            'needs_review_count':len(result['needs_review']),'invalid_vehicle_count':len(result['invalid_vehicle_ids']),
            'repeat_copied_grants':repeat['copied_grants']}

async def main():
    before=await snapshot()
    subprocess.run(['alembic','upgrade','head'],check=True)
    assert (await snapshot())==before,'Historical rows changed during upgrade'
    transfer=await transition()
    # Only the isolated clone is downgraded; runtime is never downgraded.
    subprocess.run(['alembic','downgrade','release_317_merge_heads'],check=True)
    assert (await snapshot())==before,'Historical rows changed during downgrade'
    subprocess.run(['alembic','upgrade','head'],check=True)
    after=(await snapshot());assert after==before,'Historical rows changed during round trip'
    print(json.dumps({'database':'s26_migration_test','round_trip':'passed','historical_rows_unchanged':True,'tables':after,'transition':transfer},indent=2))

if __name__=='__main__':asyncio.run(main())
