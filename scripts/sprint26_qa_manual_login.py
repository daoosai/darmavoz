"""Prepare ordinary password login for dedicated TEST QA staff/professional roles.

No credentials are printed. Client SMS login still requires a controlled QA phone;
this helper never introduces an authentication bypass or contacts real users.
"""
import argparse,asyncio,json,secrets
from pathlib import Path
from uuid import UUID
import httpx
from sqlalchemy import select
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import User
from app.security.auth import get_password_hash

async def run(prepare):
    assert settings.PAYMENT_TEST_MODE and settings.YOOKASSA_SECRET_KEY.startswith('test_')
    path=Path('/opt/darmavoz_test_backups/sprint26/qa-auth.json');qa=json.loads(path.read_text())
    roles=['admin','logist','driver','supplier','equipment_owner','water_septic_partner'];created=[]
    async with AsyncSessionLocal() as db:
        assert db.bind.url.database=='darmavoz_test'
        for role in roles:
            user=await db.get(User,UUID(qa[role]['id']))
            assert user.username=='s26-qa-release-'+role and user.email==user.username+'@example.invalid' and user.is_active
            if prepare and not qa[role].get('password'):
                password=secrets.token_urlsafe(32);user.hashed_password=get_password_hash(password);qa[role]['password']=password;created.append(role)
        if prepare:
            # Private recovery copy precedes commit; credentials never enter Git.
            temp=path.with_suffix('.manual-login-pending');temp.write_text(json.dumps(qa));temp.chmod(0o600)
            await db.commit();temp.replace(path)
    results=[]
    async with httpx.AsyncClient(base_url='https://test.darmavoz.ru',timeout=25) as client:
        for role in roles:
            if role=='driver':results.append({'role':role,'ordinary_login':'password prepared; SMS verification requires a controlled QA phone','sms_requested_by_this_run':False});continue
            if not qa[role].get('password'):results.append({'role':role,'ordinary_login':'not prepared'});continue
            r=await client.post('/api/v1/auth/login',data={'username':'s26-qa-release-'+role,'password':qa[role]['password']})
            assert r.status_code==200,'QA login failed for '+role
            body=r.json();assert body['access_token'] and body['role']==role
            results.append({'role':role,'ordinary_login':'HTTP 200','password_reported':False})
    print(json.dumps({'environment':'test','new_passwords_only_for_QA_roles':created,'login_checks':results,'client_sms':'not tested; requires a controlled QA phone','credentials':'private qa-auth.json, mode0600'},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');a=p.parse_args();asyncio.run(run(a.prepare))
