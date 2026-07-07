from app.models.models import ModerationStatus

REQUIRED_VEHICLE_MEDIA_SLOTS = {"vehicle_main", "vehicle_left", "vehicle_plate"}


def vehicle_has_required_profile(vehicle) -> bool:
    return bool(
        vehicle is not None
        and vehicle.brand
        and vehicle.plate_number
        and vehicle.vehicle_type
        and (vehicle.cubature_max is not None or vehicle.cubature_min is not None)
    )


def vehicle_media_slot_keys(media_files) -> set[str]:
    return {
        media_file.slot_key
        for media_file in media_files or []
        if media_file.slot_key in REQUIRED_VEHICLE_MEDIA_SLOTS
    }


def vehicle_has_required_photos(media_files) -> bool:
    return vehicle_media_slot_keys(media_files) == REQUIRED_VEHICLE_MEDIA_SLOTS


def vehicle_is_ready_for_moderation(vehicle, media_files) -> bool:
    return vehicle_has_required_profile(vehicle) and vehicle_has_required_photos(media_files)


def set_moderation_status(entity, moderation_status: str) -> None:
    entity.moderation_status = moderation_status
    entity.moderation_comment = None
    entity.moderated_at = None
    entity.moderated_by_user_id = None


def set_incomplete_moderation(entity) -> None:
    set_moderation_status(entity, ModerationStatus.incomplete.value)


def set_pending_moderation(entity) -> None:
    set_moderation_status(entity, ModerationStatus.pending_moderation.value)
