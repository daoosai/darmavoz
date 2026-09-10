"""Reviewable, idempotent city assignment; dry run unless --apply is supplied.

Run as `python -m scripts.city_backfill --decisions decisions.json`.
Decision format: {"quarries": {"object-uuid": "city-code"}, ...}.
No addresses, phone numbers, credentials or database URL are printed.
"""
import argparse
import asyncio
import json
from pathlib import Path

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.db.database import AsyncSessionLocal, engine
from app.models.models import (
    City, ClientAddress, Order, Quarry, SepticProviderProfile,
    SpecialEquipmentApplication, SpecialEquipmentListing, WaterPoint, User, Driver, user_cities, driver_cities,
)

MODELS = {model.__tablename__: model for model in (
    Quarry, WaterPoint, SepticProviderProfile, SpecialEquipmentListing,
    ClientAddress, Order, SpecialEquipmentApplication,
)}


async def run(decisions: dict, apply: bool, assign_all_existing_city_code: str | None = None):
    engine.echo = False
    if set(decisions) - MODELS.keys():
        raise ValueError("Unknown table in decisions")
    async with AsyncSessionLocal() as db:
        if not apply:
            await db.execute(text("SET TRANSACTION READ ONLY"))
        cities = list((await db.scalars(select(City))).all())
        by_code = {city.code: city for city in cities}
        bootstrap_city = None
        if assign_all_existing_city_code:
            bootstrap_city = by_code.get(assign_all_existing_city_code)
            if bootstrap_city is None:
                raise ValueError('Bootstrap city does not exist')
            if apply:
                await db.execute(text('SELECT pg_advisory_xact_lock(220022)'))
                await db.refresh(bootstrap_city)
            if bootstrap_city.legacy_backfill_completed:
                print(json.dumps({'mode': 'already completed', 'city_code': bootstrap_city.code}))
                return
        result = {"mode": "apply" if apply else "preview", "tables": {}}
        for table, model in MODELS.items():
            rows = list((await db.scalars(select(model))).all())
            row_ids = {str(row.id) for row in rows}
            if set(decisions.get(table, {})) - row_ids:
                raise ValueError(f"Unknown object in {table}")
            candidates, unresolved, conflicts = [], [], []
            for row in rows:
                code = decisions.get(table, {}).get(str(row.id)) or assign_all_existing_city_code
                reason = "approved initial test-market assignment" if bootstrap_city else "reviewed decision"
                # Only a dedicated city field is evidence. Address substrings and
                # coordinates cannot establish the object's market of service.
                if not code and model is SpecialEquipmentListing:
                    matches = [city for city in cities if city.name.casefold() == (row.city or '').strip().casefold()]
                    if len(matches) == 1:
                        code, reason = matches[0].code, "unique legacy city field"
                if code and code not in by_code:
                    raise ValueError(f"Unknown city code in {table}")
                if row.city_id is not None:
                    if code and row.city_id != by_code[code].id:
                        conflicts.append(str(row.id))
                    continue
                if not code:
                    unresolved.append(str(row.id))
                    continue
                city = by_code[code]
                candidates.append({"id": str(row.id), "city_code": code, "reason": reason})
                if apply:
                    await db.execute(update(model).where(model.id == row.id, model.city_id.is_(None)).values(city_id=city.id))
                    owner_id = getattr(row, "owner_user_id", None)
                    if owner_id:
                        await db.execute(insert(user_cities).values(user_id=owner_id, city_id=city.id).on_conflict_do_nothing())
            result["tables"][table] = {"total": len(rows), "candidates": candidates, "unresolved": unresolved, "conflicts": conflicts}
        if any(data['conflicts'] for data in result['tables'].values()):
            await db.rollback()
            result['mode'] = 'conflict: no changes committed'
            print(json.dumps(result, ensure_ascii=False, indent=2))
            raise RuntimeError('City conflicts require review; no changes committed')
        elif apply:
            if bootstrap_city:
                for model, table, column in ((User, user_cities, 'user_id'), (Driver, driver_cities, 'driver_id')):
                    for owner_id in (await db.scalars(select(model.id))).all():
                        await db.execute(insert(table).values({column: owner_id, 'city_id': bootstrap_city.id}).on_conflict_do_nothing())
                bootstrap_city.legacy_backfill_completed = True
            await db.commit()
        print(json.dumps(result, ensure_ascii=False, indent=2))
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decisions", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--assign-all-existing-city-code", help="Use only after explicit approval of the initial market; recorded once")
    args = parser.parse_args()
    data = json.loads(args.decisions.read_text(encoding="utf-8")) if args.decisions else {}
    asyncio.run(run(data, args.apply, args.assign_all_existing_city_code))
