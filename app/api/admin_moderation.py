from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import ModerationAuditLog, User
from app.schemas.moderation import ModerationAuditLogOut
from app.security.auth import get_current_logist_user

router = APIRouter()
SUPPORTED_ENTITY_TYPES = {"quarry", "equipment"}


@router.get("/audit-logs/{entity_type}/{entity_id}", response_model=list[ModerationAuditLogOut])
async def get_moderation_audit_logs(
    entity_type: str,
    entity_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_logist_user),
) -> list[ModerationAuditLog]:
    del current_user
    if entity_type not in SUPPORTED_ENTITY_TYPES:
        raise HTTPException(status_code=404, detail="Audit entity type not found")
    result = await db.execute(
        select(ModerationAuditLog)
        .where(
            ModerationAuditLog.entity_type == entity_type,
            ModerationAuditLog.entity_id == entity_id,
        )
        .order_by(ModerationAuditLog.created_at.desc())
    )
    return list(result.scalars().all())
