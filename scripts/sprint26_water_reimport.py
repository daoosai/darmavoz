"""Test-only commercial-water reimport with private immutable preview; unknown prices stay staged."""
import argparse,asyncio,json,hashlib,os
from dataclasses import asdict
from pathlib import Path
from sqlalchemy import select,func
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import City
from app.schemas.parser import ParserRunRequest
from app.services.twogis_places import ParsedPlace,search_places,upsert_places

PREVIEW=Path('/opt/darmavoz_test_backups/sprint26/water-sellers-preview.json')

def seller(place):
    rubrics=' '.join(str(x) for x in place.parsed_data.get('rubrics',[])).casefold()
    # A search match alone cannot turn a public spring/fountain into a seller.
    free=any(x in rubrics for x in ['источники питьевой воды','бювет','родник','водоразборные колонки'])
    commercial=any(x in rubrics for x in ['доставка воды','доставка питьевой воды','питьевая вода','продажа воды','техническая вода','автоматы по продаже воды'])
    return commercial and not free

async def run(args):
    if not settings.PAYMENT_TEST_MODE or not settings.YOOKASSA_SECRET_KEY.startswith('test_'):
        raise RuntimeError('TEST_SHOP_REQUIRED')
    async with AsyncSessionLocal() as db:
        if db.bind.url.database!='darmavoz_test':raise RuntimeError('TEST_RUNTIME_DATABASE_ONLY')
        city=await db.scalar(select(City).where(City.code=='tyumen'))
        if not city:raise RuntimeError('TYUMEN_NOT_CONFIGURED')
        payload=ParserRunRequest(city_id=city.id,city=city.name,center_lat=city.center_lat,center_lon=city.center_lon,radius_m=30000,target='water',keyword='Продажа питьевой воды')
        if args.apply:
            raw=PREVIEW.read_bytes();digest=hashlib.sha256(raw).hexdigest()
            if args.expect_sha!=digest:raise RuntimeError('PREVIEW_CHANGED')
            saved=json.loads(raw)
            if saved['city_id']!=str(city.id) or saved['database']!='darmavoz_test':raise RuntimeError('PREVIEW_TARGET_MISMATCH')
            places=[ParsedPlace(**item) for item in saved['places']]
            if not all(seller(item) for item in places):raise RuntimeError('UNREVIEWED_WATER_SOURCE')
            await db.execute(select(func.pg_advisory_xact_lock(260030)))
            result=await upsert_places(db,payload=payload,places=places,admin_id=None,truncated=saved['truncated']);await db.commit()
            print(json.dumps({'database':'darmavoz_test','applied':True,'preview_sha256':digest,'created':result.created,'updated':result.updated,'skipped':result.skipped,'truncated':result.truncated,'unknown_prices':'inactive internal staging, not published'}))
        else:
            places={};skipped=0;truncated=False
            for keyword in ['Продажа питьевой воды','Доставка технической воды']:
                payload.keyword=keyword
                result=await search_places(payload);truncated=truncated or result.truncated
                for place in result.places:
                    if seller(place):places[place.twogis_id]=place
                    else:skipped+=1
            PREVIEW.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            raw=json.dumps({'database':'darmavoz_test','city_id':str(city.id),'truncated':truncated,'places':[asdict(x) for x in places.values()]},ensure_ascii=False,sort_keys=True).encode()
            PREVIEW.write_bytes(raw);os.chmod(PREVIEW,0o600)
            print(json.dumps({'database':'darmavoz_test','applied':False,'commercial_count':len(places),'unconfirmed_skipped':skipped,'truncated':truncated,'preview_sha256':hashlib.sha256(raw).hexdigest(),'private_preview':str(PREVIEW)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');parser.add_argument('--expect-sha');asyncio.run(run(parser.parse_args()))
