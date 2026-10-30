"""Archive explicitly selected legacy free-water catalog data on TEST only.

No delete/repricing: historical orders retain their material and original sums.
Preview first; apply needs its digest. Backup contains the exact rows to restore.
"""
import argparse,asyncio,gzip,hashlib,json
from datetime import datetime,timezone
from pathlib import Path
from uuid import UUID
from sqlalchemy import select,update,text
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import Material,Category,quarry_materials
from app.services import subscriptions as policy

async def run(args):
    assert settings.PAYMENT_TEST_MODE and settings.YOOKASSA_SECRET_KEY.startswith('test_'),'Test shop required'
    async with AsyncSessionLocal() as db:
        assert db.bind.url.database=='darmavoz_test','Only the test database is allowed'
        assert await policy.enabled(db)
        material=await db.scalar(select(Material).where(Material.id==args.material_id).with_for_update())
        assert material is not None
        category=await db.get(Category,material.category_id)
        assert category.slug.lower() in {'water','вода'} or category.name.lower()=='вода'
        assert material.name.strip().casefold()=='бесплатная вода','Explicit legacy free-water record required'
        offers=(await db.execute(select(quarry_materials).where(quarry_materials.c.material_id==material.id).with_for_update())).mappings().all()
        positive=sum(1 for x in offers if x['is_active'] and x['price'] is not None and x['price']>0)
        snapshot={'material':{c.name:getattr(material,c.name) for c in Material.__table__.columns},'offers':[dict(x) for x in offers]}
        encoded=json.dumps(snapshot,sort_keys=True,ensure_ascii=False,default=str).encode()
        digest=hashlib.sha256(encoded).hexdigest()
        refs=(await db.execute(text("""SELECT tc.table_name,kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='materials' AND ccu.column_name='id'"""))).all()
        dependencies={}
        for table,column in refs:
            assert table.replace('_','').isalnum() and column.replace('_','').isalnum()
            dependencies[table]=await db.scalar(text(f'SELECT count(*) FROM "{table}" WHERE "{column}"=:id'),{'id':material.id})
        report={'environment':'test','material_id':str(material.id),'preview_sha256':digest,'material_was_active':material.is_active,'offer_count':len(offers),'active_offer_count':sum(bool(x['is_active']) for x in offers),'positive_active_offers':positive,'dependencies_preserved':dependencies,'applied':False}
        if args.apply:
            assert args.expect_sha==digest,'Preview digest changed; inspect a new preview'
            assert positive==0,'Do not silently archive active paid offers'
            folder=Path('/opt/darmavoz_test_backups/sprint26');folder.mkdir(mode=0o700,parents=True,exist_ok=True)
            backup=folder/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-legacy-water-'+digest[:12]+'.json.gz')
            with gzip.open(backup,'wb') as f:f.write(encoded)
            backup.chmod(0o600)
            with gzip.open(backup,'rb') as f:assert hashlib.sha256(f.read()).hexdigest()==digest,'Backup verification failed'
            material.is_active=False
            await db.execute(update(quarry_materials).where(quarry_materials.c.material_id==material.id).values(is_active=False))
            policy.audit(db,None,None,'legacy_free_water_archived',material_id=str(material.id),offer_count=len(offers),backup_sha256=digest)
            await db.commit()
            report.update(applied=True,backup_path=str(backup),backup_sha256=hashlib.sha256(backup.read_bytes()).hexdigest(),history_deleted=False)
        print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--material-id',required=True,type=UUID);parser.add_argument('--apply',action='store_true');parser.add_argument('--expect-sha');asyncio.run(run(parser.parse_args()))
