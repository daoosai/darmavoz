"""Inspect/wake only the private QA sandbox payment; never changes payment result or access."""
import asyncio,json,sys,hashlib
from pathlib import Path
from uuid import UUID
from sqlalchemy import select,func
from app.db.database import AsyncSessionLocal
from app.models.subscriptions import SubscriptionPayment,AccessGrant
from app.services import subscriptions as s

async def main():
    fixture=json.loads(Path('/opt/darmavoz_test_backups/sprint26/qa-auth.json').read_text())
    async with AsyncSessionLocal() as db:
        if db.bind.url.database!='darmavoz_test':raise RuntimeError('TEST_RUNTIME_ONLY')
        row=await db.get(SubscriptionPayment,UUID(fixture['sandbox']['payment_id']))
        if not row or str(row.account_id)!=fixture['supplier']['id']:raise RuntimeError('QA_PAYMENT_ONLY')
        if sys.argv[-1]=='wake':row.next_attempt_at=s.now();await db.commit()
        print(json.dumps({'payment_id':str(row.id),'provider_id':row.provider_id,'status':row.status,'attempts':row.attempts,
            'idempotence_digest':hashlib.sha256(row.idempotence_key.encode()).hexdigest(),
            'source_grants':await db.scalar(select(func.count()).select_from(AccessGrant).where(AccessGrant.source_key=='payment:'+str(row.id)))}))

if __name__=='__main__':asyncio.run(main())
