import asyncio
import os
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)


def _build_deleted_unique_value(value: str | None, *, max_length: int, marker: str = "_d") -> str:
    suffix = f"{marker}{uuid4().hex[:6]}"
    base = (value or "deleted").strip() or "deleted"
    if len(base) + len(suffix) > max_length:
        base = base[: max_length - len(suffix)]
    return f"{base}{suffix}"


async def main() -> int:
    project_root = Path(__file__).resolve().parents[1]
    _load_env_file(project_root / ".env")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not configured", file=sys.stderr)
        return 1

    engine = create_async_engine(database_url)
    patched_drivers = 0
    patched_users = 0

    async with engine.begin() as conn:
        driver_rows = (
            await conn.execute(
                text(
                    """
                    select d.id, d.phone
                    from drivers d
                    left join users u on u.id = d.user_id
                    where d.is_active = false
                       or u.id is null
                       or coalesce(u.is_active, false) = false
                    """
                )
            )
        ).mappings().all()

        for row in driver_rows:
            phone = row["phone"] or ""
            if "_d" in phone or "_del_" in phone:
                continue
            await conn.execute(
                text(
                    "update drivers set phone = :phone where id = :id"
                ),
                {"id": row["id"], "phone": _build_deleted_unique_value(phone, max_length=20)},
            )
            patched_drivers += 1

        user_rows = (
            await conn.execute(
                text(
                    """
                    select u.id, u.username
                    from users u
                    join roles r on r.id = u.role_id
                    left join drivers d on d.user_id = u.id
                    where r.name = 'driver'
                      and d.id is null
                    """
                )
            )
        ).mappings().all()

        for row in user_rows:
            username = row["username"] or ""
            if "_d" in username or "_del_" in username:
                continue
            await conn.execute(
                text(
                    "update users set username = :username, is_active = false where id = :id"
                ),
                {"id": row["id"], "username": _build_deleted_unique_value(username, max_length=50)},
            )
            patched_users += 1

    await engine.dispose()
    print(f"patched_drivers={patched_drivers}")
    print(f"patched_users={patched_users}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
