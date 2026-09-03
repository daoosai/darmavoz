"""Backfill legacy quarry and water-point CRM statuses.

The current production CRM enum uses ``activated`` as the successor to the
legacy ``agreed`` status.  Public maps and point APIs treat ``activated`` as
the available state.

Run inside the backend container:
    python scripts/fix_legacy_crm_statuses.py --dry-run
    python scripts/fix_legacy_crm_statuses.py
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import DeclarativeBase


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.database import AsyncSessionLocal
from app.models.models import CRM_STATUS_VALUES, CrmStatus, Quarry, WaterPoint


TARGET_STATUS = CrmStatus.activated.value
VALID_STATUSES = tuple(CRM_STATUS_VALUES)


def legacy_status_filter(model: type[DeclarativeBase]):
    return or_(
        model.crm_status.is_(None),
        model.crm_status.not_in(VALID_STATUSES),
    )


async def count_legacy_rows(model: type[DeclarativeBase]) -> int:
    async with AsyncSessionLocal() as session:
        return int(
            await session.scalar(
                select(func.count()).select_from(model).where(legacy_status_filter(model))
            )
            or 0
        )


async def apply_backfill(models: Sequence[type[DeclarativeBase]]) -> dict[str, int]:
    async with AsyncSessionLocal() as session:
        updated: dict[str, int] = {}
        for model in models:
            result = await session.execute(
                update(model)
                .where(legacy_status_filter(model))
                .values(crm_status=TARGET_STATUS, is_active=True)
            )
            updated[model.__tablename__] = result.rowcount or 0
        await session.commit()
        return updated


async def main(dry_run: bool) -> None:
    models = (Quarry, WaterPoint)
    counts = {model.__tablename__: await count_legacy_rows(model) for model in models}

    if dry_run:
        print(
            "legacy_crm_status_backfill_dry_run "
            f"target_status={TARGET_STATUS} "
            f"quarries={counts['quarries']} water_points={counts['water_points']}"
        )
        return

    updated = await apply_backfill(models)
    print(
        "legacy_crm_status_backfill_completed "
        f"target_status={TARGET_STATUS} "
        f"quarries={updated['quarries']} water_points={updated['water_points']}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Report matching rows without changing data")
    args = parser.parse_args()
    asyncio.run(main(args.dry_run))
