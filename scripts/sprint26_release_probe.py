"""Read-only release evidence for test runtime and unchanged production baseline."""
import hashlib,json,re,subprocess,sys,urllib.request
from datetime import datetime,UTC
from pathlib import Path
ROOT=Path('/opt/darmavoz_test')
RUNTIME=Path('/opt/darmavoz_test_deploy')
BASE='https://test.darmavoz.ru'

def command(*args):return subprocess.check_output(args,text=True).strip()
def fetch(path):return json.load(urllib.request.urlopen(BASE+path,timeout=30))

def main():
    release=sys.argv[1];assert re.fullmatch('[0-9a-f]{40}',release)
    assert command('git','-C',str(ROOT),'branch','--show-current')=='develop'
    assert command('git','-C',str(RUNTIME),'rev-parse','HEAD')==release
    assert not Path('/opt/darmavoz_test_backups/sprint26/qa-visual-access.json').exists(),'RESTORE_QA_VISUAL_TRIAL_FIRST'
    build=fetch('/build-info.json');assert build['commit']==release and build['environment']=='test'
    health=fetch('/health');assert health.get('version')=='3.3.3'
    files=['app/services/subscriptions.py','app/services/subscription_billing.py','app/services/journey.py','app/services/pickup_points.py','app/schemas/equipment.py','alembic/versions/s26_subscription_platform.py']
    hashes={path:hashlib.sha256(subprocess.check_output(['git','-C',str(ROOT),'show',release+':'+path])).hexdigest() for path in files}
    code="import hashlib,json,sys;from pathlib import Path;print(json.dumps({p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in json.loads(sys.argv[1])}))"
    image_hashes=json.loads(command('docker','exec','backend_test','python','-c',code,json.dumps(files)))
    assert image_hashes==hashes,'RUNNING_IMAGE_SOURCE_DIFFERS_FROM_RELEASE'
    probe='''
import asyncio,json
from sqlalchemy import text,select,func
from app.db.database import AsyncSessionLocal
from app.core.config import settings
from app.services.subscriptions import config
from app.models.models import WaterPoint,User
from app.models.commerce import Payment,Refund
async def main():
 async with AsyncSessionLocal() as db:
  assert db.bind.url.database=='darmavoz_test'
  cfg=await config(db);flags={k:cfg[k] for k in ['enabled','direct_orders','water_paid_only','chat_enabled','journey_enabled']};assert all(flags.values())
  from uuid import UUID
  owner=await db.get(User,UUID(cfg['owner_id']));assert owner.username=='s26-qa-release-admin'
  print(json.dumps({'database':'darmavoz_test','migration':await db.scalar(text('select version_num from alembic_version')),'features':flags,'test_shop':bool(settings.PAYMENT_TEST_MODE and settings.YOOKASSA_SECRET_KEY.startswith('test_')),'owner_alerts':'QA admin only','free_water_points':await db.scalar(select(func.count()).select_from(WaterPoint).where(WaterPoint.water_type=='free')),'inactive_water_staging':await db.scalar(select(func.count()).select_from(WaterPoint).where(WaterPoint.water_type=='unknown',WaterPoint.is_active.is_(False),WaterPoint.moderation_status=='pending_moderation')),'historical_order_payments':await db.scalar(select(func.count()).select_from(Payment)),'historical_order_refunds':await db.scalar(select(func.count()).select_from(Refund))}))
asyncio.run(main())
'''
    db=json.loads(subprocess.check_output(['docker','exec','-i','backend_test','python','-'],input=probe,text=True));assert db['migration']=='s26_subscription_platform' and db['test_shop'] and db['free_water_points']==0
    test=json.loads(command('docker','inspect','backend_test'))[0]
    before=json.loads((ROOT/'docs/reports/sprint26/baseline.json').read_text())
    ids=command('docker','ps','-aq','--filter','label=com.docker.compose.project.working_dir=/opt/darmavoz_deploy').split()
    prod=next(x for x in json.loads(subprocess.check_output(['docker','inspect',*ids])) if x['Config']['Labels'].get('com.docker.compose.service')=='backend')
    current={'image':prod['Image'],'started_at':prod['State']['StartedAt'],'restart_count':prod['RestartCount']};assert current==before['production']
    envs={path:hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest for path,digest in before['env_sha256'].items()};assert all(envs.values())
    report={'verified_at':datetime.now(UTC).isoformat(),'code_commit':release,'source_head':command('git','-C',str(ROOT),'rev-parse','HEAD'),'runtime_head':release,'web_build':build,'health':health,'backend_image':test['Image'],'backend_started_at':test['State']['StartedAt'],'backend_restart_count':test['RestartCount'],'running_sources_match_release':True,'source_hashes':hashes,**db,'env_files_unchanged':envs,'production_unchanged':current}
    (ROOT/'docs/reports/sprint26/test-deployment.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
