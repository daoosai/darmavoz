from pathlib import Path
import os
import sys

import httpx


def load_env_value(*names: str) -> str | None:
    env_path = Path(".env")
    if env_path.exists():
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key in names:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                    value = value[1:-1]
                if value:
                    return value
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


api_key = load_env_value("SMS_RU_API_ID", "SMSRU_API_KEY")
if not api_key:
    raise SystemExit("SMS.ru API key not found in .env")

phone = os.getenv("SMS_DEBUG_PHONE", "79990000001")
url = "https://sms.ru/sms/send"
params = {
    "api_id": api_key,
    "to": phone,
    "msg": "???????? ??? 1234",
    "json": 1,
}

try:
    response = httpx.get(url, params=params, timeout=20.0)
    print(response.text)
except Exception as exc:
    print(f"REQUEST_FAILED: {exc}", file=sys.stderr)
    raise
