"""Test-only water cleanup. Preview SHA binds apply; private backup precedes deletion.

Run in the selected test backend environment after migration, never with production settings.
Object-storage images are retained; backup includes their metadata for restoration.
"""
import argparse,asyncio,gzip,hashlib,json,os
from datetime import datetime,UTC
from pathlib import Path
from sqlalchemy import select,text,delete,or_
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import WaterPoint,MediaFile,PointAuditLog

BACKUP_ROOT = Path("/opt/darmavoz_test_backups/sprint26")


def row_data(row):
    return {col.name:getattr(row,col.name) for col in row.__table__.columns}

async def run(args):
    if not settings.PAYMENT_TEST_MODE:
        raise RuntimeError('TEST_DATABASE_AND_TEST_SHOP_REQUIRED')
    async with AsyncSessionLocal() as db:
        database=db.bind.url.database or ''
        if 'test' not in database.lower():
            raise RuntimeError('TEST_DATABASE_AND_TEST_SHOP_REQUIRED')
        db.bind.echo=False
        await db.execute(text('LOCK TABLE water_points, media_files, point_audit_log IN SHARE ROW EXCLUSIVE MODE'))
        foreign=(await db.execute(text("SELECT conrelid::regclass::text,conname FROM pg_constraint WHERE contype='f' AND confrelid='water_points'::regclass"))).all()
        if foreign:raise RuntimeError('UNREVIEWED_FOREIGN_KEYS: '+','.join(f'{t}:{c}' for t,c in foreign))
        points=list((await db.scalars(select(WaterPoint).where(or_(WaterPoint.water_type=='free',WaterPoint.is_free.is_(True))).order_by(WaterPoint.id).with_for_update())).all())
        ids=[p.id for p in points]
        media=list((await db.scalars(select(MediaFile).where(MediaFile.entity_type=='water_point',MediaFile.entity_id.in_(ids)).order_by(MediaFile.id))).all())
        audits=list((await db.scalars(select(PointAuditLog).where(PointAuditLog.point_kind=='water',PointAuditLog.point_id.in_(ids)).order_by(PointAuditLog.id))).all())
        data={'water_points':[row_data(x) for x in points],'media_files':[row_data(x) for x in media],'point_audit_log':[row_data(x) for x in audits]}
        encoded=json.dumps(data,ensure_ascii=False,default=str,sort_keys=True).encode();digest=hashlib.sha256(encoded).hexdigest()
        result={'database':database,'free_point_ids':[str(x) for x in ids],'point_count':len(ids),'media_count':len(media),'audit_count':len(audits),'preview_sha256':digest,'applied':False}
        if args.apply:
            if args.expect_sha!=digest:raise RuntimeError('PREVIEW_CHANGED_REPEAT_DRY_RUN')
            root=BACKUP_ROOT;root.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(root,0o700)
            dest=root/(datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')+'-'+digest[:12]+'.json.gz')
            with gzip.open(dest,'wb') as out:out.write(encoded)
            os.chmod(dest,0o600)
            # Verify bytes before the first delete; backup remains if commit fails.
            with gzip.open(dest,'rb') as saved:
                if hashlib.sha256(saved.read()).hexdigest()!=digest:raise RuntimeError('BACKUP_VERIFICATION_FAILED')
            await db.execute(delete(MediaFile).where(MediaFile.entity_type=='water_point',MediaFile.entity_id.in_(ids)))
            await db.execute(delete(PointAuditLog).where(PointAuditLog.point_kind=='water',PointAuditLog.point_id.in_(ids)))
            await db.execute(delete(WaterPoint).where(WaterPoint.id.in_(ids)))
            await db.commit();result.update(applied=True,backup_path=str(dest))
        print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');parser.add_argument('--expect-sha');args=parser.parse_args()
    asyncio.run(run(args))
