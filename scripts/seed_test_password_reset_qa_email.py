import asyncio

from sqlalchemy import func, select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.models import Role, User


QA_EMAIL = "berezindanil2004@gmail.com"
QA_ROLE_PRIORITY = ("admin", "logist")


def _ensure_test_database() -> None:
    if "test" not in settings.DATABASE_URL.lower():
        raise RuntimeError("This script may only be run against the test database.")


async def main() -> None:
    _ensure_test_database()

    async with AsyncSessionLocal() as session:
        qa_user: User | None = None
        qa_role: str | None = None

        for role_name in QA_ROLE_PRIORITY:
            result = await session.execute(
                select(User)
                .join(Role, User.role_id == Role.id)
                .where(
                    Role.name == role_name,
                    User.is_active.is_(True),
                    User.is_deleted.is_(False),
                )
                .order_by(User.id)
            )
            qa_user = result.scalars().first()
            if qa_user is not None:
                qa_role = role_name
                break

        if qa_user is None or qa_role is None:
            raise RuntimeError("No active admin or logist user was found in the test database.")

        email_owner = (
            await session.execute(
                select(User)
                .where(func.lower(User.email) == QA_EMAIL)
                .order_by(User.id)
            )
        ).scalars().first()
        if email_owner is not None and email_owner.id != qa_user.id:
            raise RuntimeError(
                "The QA email is already assigned to another user; no changes were made."
            )

        changed = qa_user.email != QA_EMAIL
        if changed:
            qa_user.email = QA_EMAIL
            await session.commit()

        print(
            "QA password reset account is ready "
            f"(role={qa_role}, email={QA_EMAIL}, changed={changed})."
        )


if __name__ == "__main__":
    asyncio.run(main())
