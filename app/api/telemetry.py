from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import ErrorLog
from app.schemas.telemetry import TelemetryErrorIn, TelemetryErrorOut

router = APIRouter(prefix="/telemetry")


@router.post("/errors", response_model=TelemetryErrorOut, status_code=status.HTTP_201_CREATED)
async def create_error_log(
    payload: TelemetryErrorIn,
    db: AsyncSession = Depends(get_db),
) -> TelemetryErrorOut:
    normalized_payload = payload.payload
    if normalized_payload is not None and not isinstance(normalized_payload, (dict, list, str, int, float, bool)):
        normalized_payload = {"value": str(normalized_payload)}

    error_log = ErrorLog(
        error_code=(payload.error_code or "FRONTEND").strip()[:32] or "FRONTEND",
        user_id=payload.user_id,
        message=payload.message,
        payload=normalized_payload,
    )
    db.add(error_log)
    await db.commit()
    await db.refresh(error_log)
    return TelemetryErrorOut(ok=True, error_log_id=error_log.id)
