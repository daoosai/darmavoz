from fastapi import APIRouter, Depends
from app.security.auth import get_current_admin_user
from app.models.models import User

router = APIRouter()

@router.get("/stats")
async def get_admin_stats(current_admin: User = Depends(get_current_admin_user)):
    return {"status": "ok", "message": "Admin area"}
