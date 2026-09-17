from app.utils.phones import normalize_phone


GOOGLE_PLAY_REVIEWER_PHONE = "+70000000000"
GOOGLE_PLAY_REVIEWER_PHONE_VALUES = (GOOGLE_PLAY_REVIEWER_PHONE, "70000000000")
GOOGLE_PLAY_REVIEWER_OTP = "7777"


def is_google_play_reviewer_phone(phone: str) -> bool:
    return normalize_phone(phone) == GOOGLE_PLAY_REVIEWER_PHONE
