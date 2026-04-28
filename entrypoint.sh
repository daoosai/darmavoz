#!/bin/bash
set -e

DB_HOST=$(python - <<PY
import os
from urllib.parse import urlparse
url = os.environ.get("DATABASE_URL", "")
print(urlparse(url).hostname or "postgres")
PY
)
DB_PORT=$(python - <<PY
import os
from urllib.parse import urlparse
url = os.environ.get("DATABASE_URL", "")
print(urlparse(url).port or 5432)
PY
)

echo "Waiting for database at ${DB_HOST}:${DB_PORT}..."
while ! nc -z "$DB_HOST" "$DB_PORT"; do
  sleep 0.2
done
echo "Database is up!"

echo "Running migrations..."
alembic upgrade head

echo "Starting application..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
