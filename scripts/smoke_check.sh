#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

BASE_URL=${BASE_URL:-${APP_BASE_URL:-https://darmavoz.ru}}
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
LOGIST_USERNAME=${LOGIST_USERNAME:-}
LOGIST_PASSWORD=${LOGIST_PASSWORD:-}
MANAGER_USERNAME=${MANAGER_USERNAME:-}
MANAGER_PASSWORD=${MANAGER_PASSWORD:-}
WEBHOOK_TOKEN=${WEBHOOK_TOKEN:-${AVITO_WEBHOOK_URL_TOKEN:-}}
WEBHOOK_SECRET=${WEBHOOK_SECRET:-${AVITO_WEBHOOK_SECRET:-}}
WEBHOOK_HEADER_NAME=${WEBHOOK_HEADER_NAME:-${AVITO_WEBHOOK_HEADER_NAME:-X-Webhook-Secret}}
RUN_ID=${RUN_ID:-$(date +%s)}
CLIENT_PHONE=${CLIENT_PHONE:-+7999${RUN_ID}}
DRIVER_PHONE=${DRIVER_PHONE:-+7888${RUN_ID}}
CLIENT_NAME=${CLIENT_NAME:-Smoke Client ${RUN_ID}}
DRIVER_NAME=${DRIVER_NAME:-Smoke Driver ${RUN_ID}}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

request() {
  local method=$1
  local url=$2
  local body=${3:-}
  shift 3 || true
  local -a headers=("$@")
  local body_file="$TMP_DIR/body.json"
  local status

  if [[ -n "$body" ]]; then
    status=$(curl -ksS -o "$body_file" -w "%{http_code}" -X "$method" "$url" -H 'Content-Type: application/json' "${headers[@]}" --data "$body")
  else
    status=$(curl -ksS -o "$body_file" -w "%{http_code}" -X "$method" "$url" "${headers[@]}")
  fi

  BODY_FILE="$body_file" STATUS_CODE="$status" python3 - <<'INNERPY'
import json, os, pathlib
path = pathlib.Path(os.environ['BODY_FILE'])
raw = path.read_text() if path.exists() else ''
try:
    data = json.loads(raw) if raw else None
except Exception:
    data = raw
print(json.dumps({"status": int(os.environ['STATUS_CODE']), "body": data}, ensure_ascii=False))
INNERPY
}

extract_token() {
  python3 -c "import json,sys; print(json.load(sys.stdin)['body']['access_token'])"
}

assert_status() {
  local expected=$1
  local response=$2
  RESPONSE="$response" EXPECTED="$expected" python3 - <<'INNERPY'
import json, os
payload = json.loads(os.environ['RESPONSE'])
expected = int(os.environ['EXPECTED'])
if payload['status'] != expected:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    raise SystemExit(1)
INNERPY
}

login_and_get_token() {
  local username=$1
  local password=$2
  local login_response
  local login_payload

  login_response=$(curl -ksS -o "$TMP_DIR/login_${username}.json" -w "%{http_code}" -X POST "$BASE_URL/api/v1/auth/login" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "username=$username" \
    --data-urlencode "password=$password")

  login_payload=$(STATUS_CODE="$login_response" BODY_FILE="$TMP_DIR/login_${username}.json" python3 - <<'INNERPY'
import json, os, pathlib
raw = pathlib.Path(os.environ['BODY_FILE']).read_text()
print(json.dumps({"status": int(os.environ['STATUS_CODE']), "body": json.loads(raw)}, ensure_ascii=False))
INNERPY
  )

  assert_status 200 "$login_payload"
  echo "$login_payload" >&2
  printf '%s' "$login_payload" | extract_token
}

check_role_area() {
  local label=$1
  local username=$2
  local password=$3
  local path=$4

  echo "[$label] login"
  local token
  token=$(login_and_get_token "$username" "$password")
  local auth_header="Authorization: Bearer $token"
  local area_response
  area_response=$(request GET "$BASE_URL/api/v1/admin/$path" '' -H "$auth_header")
  assert_status 200 "$area_response"
  echo "$area_response"
}

if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "ADMIN_PASSWORD is required" >&2
  exit 1
fi

echo "[1/7] health"
health_response=$(request GET "$BASE_URL/health" '')
assert_status 200 "$health_response"
echo "$health_response"

echo "[2/7] admin login + admin area"
TOKEN=$(login_and_get_token "$ADMIN_USERNAME" "$ADMIN_PASSWORD")
AUTH_HEADER="Authorization: Bearer $TOKEN"
admin_area=$(request GET "$BASE_URL/api/v1/admin/stats" '' -H "$AUTH_HEADER")
assert_status 200 "$admin_area"
echo "$admin_area"

echo "[3/7] clients create + list"
client_create=$(request POST "$BASE_URL/api/v1/clients/" "{\"name\": \"$CLIENT_NAME\", \"phone\": \"$CLIENT_PHONE\"}" -H "$AUTH_HEADER")
assert_status 201 "$client_create"
echo "$client_create"
client_list=$(request GET "$BASE_URL/api/v1/clients/" '' -H "$AUTH_HEADER")
assert_status 200 "$client_list"
echo "$client_list"

echo "[4/7] drivers create + list"
driver_create=$(request POST "$BASE_URL/api/v1/drivers/" "{\"name\": \"$DRIVER_NAME\", \"phone\": \"$DRIVER_PHONE\", \"status\": \"available\"}" -H "$AUTH_HEADER")
assert_status 201 "$driver_create"
echo "$driver_create"
driver_list=$(request GET "$BASE_URL/api/v1/drivers/" '' -H "$AUTH_HEADER")
assert_status 200 "$driver_list"
echo "$driver_list"

echo "[5/7] role logins"
if [[ -n "$LOGIST_USERNAME" && -n "$LOGIST_PASSWORD" ]]; then
  check_role_area 'logist' "$LOGIST_USERNAME" "$LOGIST_PASSWORD" 'logist-area'
else
  echo '{"skipped":"logist credentials are not configured"}'
  exit 1
fi

if [[ -n "$MANAGER_USERNAME" && -n "$MANAGER_PASSWORD" ]]; then
  check_role_area 'manager' "$MANAGER_USERNAME" "$MANAGER_PASSWORD" 'manager-area'
else
  echo '{"skipped":"manager credentials are not configured"}'
  exit 1
fi

echo "[6/7] avito webhook"
webhook_url="$BASE_URL/api/v1/webhooks/avito"
if [[ -n "$WEBHOOK_TOKEN" ]]; then
  webhook_url+="?token=$WEBHOOK_TOKEN"
fi
headers=()
if [[ -n "$WEBHOOK_SECRET" ]]; then
  headers+=( -H "$WEBHOOK_HEADER_NAME: $WEBHOOK_SECRET" )
fi
webhook_payload=$(cat <<JSON
{"event_id":"smoke_evt_${RUN_ID}","account_id":"smoke_acc","payload":{"chat_id":"smoke_chat","user_id":"smoke_user","sender_user_id":"smoke_user","message_id":"smoke_msg_${RUN_ID}","text":"smoke webhook","direction":"inbound","message_type":"text"}}
JSON
)
webhook_response=$(request POST "$webhook_url" "$webhook_payload" "${headers[@]}")
assert_status 200 "$webhook_response"
echo "$webhook_response"

echo "[7/7] completed"
echo "Smoke check passed"
