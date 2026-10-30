"""Temporarily expire ONLY the dedicated QA driver's trial for visual review.

Always run restore in a host-side try/finally. Original dates persist privately;
vehicle trial history, paid grants and customer accounts are never changed.
"""
import asyncio,json,sys
from pathlib import Path
from uuid import UUID
from datetime import datetime,timedelta
from sqlalchemy import select
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import User,Driver,Order
from app.models.subscriptions import CategoryAccess
from app.services import subscriptions as s
ROOT=Path('/opt/darmavoz_test_backups/sprint26')

async def run():
    assert settings.PAYMENT_TEST_MODE and settings.YOOKASSA_SECRET_KEY.startswith('test_')
    qa=json.loads((ROOT/'qa-auth.json').read_text());uid=UUID(qa['driver']['id']);path=ROOT/'qa-visual-access.json'
    async with AsyncSessionLocal() as db:
        assert db.bind.url.database=='darmavoz_test'
        user=await db.get(User,uid);assert user.username=='s26-qa-release-driver'
        if sys.argv[1]=='expire':
            assert not path.exists(),'Restore existing QA snapshot first'
            driver=await db.get(Driver,UUID(qa['driver']['driverId']));assert driver.status=='available'
            assert not await db.scalar(select(Order.id).where(Order.driver_id==driver.id,Order.status.in_(['driver_assigned','driver_accepted','heading_to_pickup','loading','heading_to_client','delivered'])).limit(1))
            rows=(await db.scalars(select(CategoryAccess).where(CategoryAccess.account_id==uid,CategoryAccess.category.in_(['driver','carrier'])))).all()
            data=[{'id':str(x.id),'starts_at':x.trial_started_at.isoformat(),'ends_at':x.trial_ends_at.isoformat()} for x in rows]
            path.write_text(json.dumps(data));path.chmod(0o600)
            for x in rows:x.trial_started_at=s.now()-timedelta(days=15);x.trial_ends_at=s.now()-timedelta(seconds=1)
            s.audit(db,UUID(qa['admin']['id']),uid,'qa_visual_temporarily_expired',categories=['driver','carrier']);await db.commit()
        elif sys.argv[1]=='restore':
            if not path.exists():print(json.dumps({'phase':'restore','already_restored':True}));return
            data=json.loads(path.read_text())
            for x in data:
                row=await db.get(CategoryAccess,UUID(x['id']));assert row.account_id==uid and row.category in ['driver','carrier']
                row.trial_started_at=datetime.fromisoformat(x['starts_at']);row.trial_ends_at=datetime.fromisoformat(x['ends_at'])
            s.audit(db,UUID(qa['admin']['id']),uid,'qa_visual_trial_dates_restored',categories=['driver','carrier']);await db.commit();path.unlink()
        else:raise ValueError('Use expire or restore')
    print(json.dumps({'phase':sys.argv[1],'QA_only':True,'trial_dates':len(data)}))

if __name__=='__main__':asyncio.run(run())
