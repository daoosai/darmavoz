from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_DIR = Path(__file__).resolve().parents[2]
ENV_PATH = BASE_DIR / ".env"
API_URL = "https://routing.api.2gis.com/routing/7.0.0/global"


def read_env_value(path: Path, key: str) -> str | None:
    if not path.exists():
        return None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        current_key, value = line.split("=", 1)
        if current_key.strip() != key:
            continue
        cleaned = value.strip().strip("\"'")
        return cleaned or None
    return None


def build_payload() -> dict:
    return {
        "points": [
            {
                "type": "stop",
                "lon": 65.963904,
                "lat": 57.012969,
            },
            {
                "type": "stop",
                "lon": 65.527202,
                "lat": 57.152223,
            },
        ],
        "transport": "driving",
        "route_mode": "fastest",
        "traffic_mode": "jam",
        "locale": "ru",
    }


def main() -> None:
    api_key = read_env_value(ENV_PATH, "TWOGIS_API_KEY")
    if not api_key:
        raise SystemExit("TWOGIS_API_KEY not found in .env")

    payload = build_payload()
    url = f"{API_URL}?{urlencode({'key': api_key})}"
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
            print(f"status_code={response.status}")
            print("response_text=")
            print(body)
            data = json.loads(body)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"status_code={exc.code}")
        print("response_text=")
        print(body)
        return
    except URLError as exc:
        print(f"network_error={exc}")
        return

    result = data.get("result")
    if isinstance(result, list) and result:
        total_distance = result[0].get("total_distance")
        print(f"total_distance_m={total_distance}")


if __name__ == "__main__":
    main()
