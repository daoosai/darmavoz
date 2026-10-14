"""Account visibility shared by operational driver lists and dispatch admission."""

from sqlalchemy import and_, exists, or_, select

from app.models.models import Driver, User


def active_driver_account_clause():
    """Keep legacy unlinked drivers; exclude disabled/deleted linked accounts."""
    active_user = exists(
        select(User.id)
        .where(
            User.id == Driver.user_id,
            User.is_active.is_(True),
            User.is_deleted.is_(False),
        )
        .correlate(Driver)
    )
    return and_(
        Driver.is_active.is_(True),
        or_(Driver.user_id.is_(None), active_user),
    )
