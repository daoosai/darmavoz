from datetime import datetime
from typing import Literal

from pydantic import BaseModel


PlacementStatusValue = Literal[
    "active",
    "pending_moderation",
    "hidden",
    "archived",
    "confirmation_required",
    "trial",
    "expired",
]


class PlacementPolicyOut(BaseModel):
    trial_days: int
    extension_days: int
    confirmation_interval_days: int
    confirmation_grace_days: int


class PlacementSummaryOut(BaseModel):
    generated_at: datetime
    policy: PlacementPolicyOut
    totals: dict[str, int]
    by_entity: dict[str, dict[str, int]]
    active_quarries: int
    active_accumulators: int
    active_equipment: int


class PlacementActionResult(BaseModel):
    ok: bool = True
    placement_status: PlacementStatusValue
    placement_ends_at: datetime | None = None
    next_confirmation_at: datetime | None = None
