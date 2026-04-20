from fastapi import APIRouter, Depends

from app.models.models import User
from app.security.auth import (
    get_current_admin_user,
    get_current_logist_user,
    get_current_manager_user,
)

router = APIRouter()


@router.get("/stats")
async def get_admin_stats(current_admin: User = Depends(get_current_admin_user)):
    return {"status": "ok", "message": "Admin area", "role": current_admin.role.name}


@router.get("/logist-area")
async def get_logist_area(current_user: User = Depends(get_current_logist_user)):
    return {"status": "ok", "message": "Logist area", "role": current_user.role.name}


@router.get("/manager-area")
async def get_manager_area(current_user: User = Depends(get_current_manager_user)):
    return {"status": "ok", "message": "Manager area", "role": current_user.role.name}
