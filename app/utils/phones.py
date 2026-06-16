import re


_PHONE_CHARS_RE = re.compile(r"^[\d\s()+-]+$")


def normalize_phone(phone: str) -> str:
    value = phone.strip()
    digits = re.sub(r"\D", "", value)
    if not digits:
        return value

    if len(digits) == 11 and digits[0] in {"7", "8"}:
        return f"+7{digits[1:]}"
    if len(digits) == 10 and digits[0] == "9":
        return f"+7{digits}"
    if value.startswith("+"):
        return f"+{digits}"
    return f"+{digits}"


def normalize_phone_like_username(username: str) -> str:
    value = username.strip()
    if not value or not _PHONE_CHARS_RE.match(value):
        return value
    return normalize_phone(value)
