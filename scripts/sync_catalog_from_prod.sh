#!/usr/bin/env bash
set -euo pipefail

PROD_DIR="/opt/darmavoz"
TEST_DIR="/opt/darmavoz_test"
PROD_DB_CONTAINER="daoos_kit-postgres-1"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing file: $path" >&2
    exit 1
  fi
}

require_file "$PROD_DIR/.env"
require_file "$TEST_DIR/.env"

prod_user="$(python3 -c "from urllib.parse import urlparse; from pathlib import Path; url=[line.split('=',1)[1].replace('+asyncpg','') for line in Path('$PROD_DIR/.env').read_text(encoding='utf-8').splitlines() if line.startswith('DATABASE_URL=')][0]; print(urlparse(url).username)")"
prod_db="$(python3 -c "from urllib.parse import urlparse; from pathlib import Path; url=[line.split('=',1)[1].replace('+asyncpg','') for line in Path('$PROD_DIR/.env').read_text(encoding='utf-8').splitlines() if line.startswith('DATABASE_URL=')][0]; print(urlparse(url).path.lstrip('/'))")"

test_user="$(grep '^TEST_POSTGRES_USER=' "$TEST_DIR/.env" | cut -d= -f2-)"
test_db="$(grep '^TEST_POSTGRES_DB=' "$TEST_DIR/.env" | cut -d= -f2-)"
test_pass="$(grep '^TEST_POSTGRES_PASSWORD=' "$TEST_DIR/.env" | cut -d= -f2-)"

export_from_prod() {
  local query="$1"
  local output="$2"
  docker exec "$PROD_DB_CONTAINER" \
    psql -U "$prod_user" -d "$prod_db" \
    -c "\\copy ($query) TO STDOUT WITH (FORMAT csv)" > "$output"
}

export_from_prod \
  "select id, name, slug, sort_order, is_active from categories order by sort_order, name" \
  "$TMP_DIR/categories.csv"

export_from_prod \
  "select id, category_id, name, description, price, unit, min_volume, image_url, is_active, sort_order from materials order by sort_order, name" \
  "$TMP_DIR/materials.csv"

export_from_prod \
  "select id, name, address, lat, lon, is_active from quarries order by name" \
  "$TMP_DIR/quarries.csv"

export_from_prod \
  "select quarry_id, material_id from quarry_materials order by quarry_id, material_id" \
  "$TMP_DIR/quarry_materials.csv"

export_from_prod \
  "select id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at from media_files where entity_type = 'material' order by entity_id, sort_order, created_at" \
  "$TMP_DIR/material_media.csv"

export PGPASSWORD="$test_pass"
psql -h 127.0.0.1 -p 5433 -U "$test_user" -d "$test_db" <<SQL
BEGIN;

CREATE TEMP TABLE tmp_categories (
  id uuid,
  name text,
  slug text,
  sort_order integer,
  is_active boolean
);

CREATE TEMP TABLE tmp_materials (
  id uuid,
  category_id uuid,
  name text,
  description text,
  price double precision,
  unit text,
  min_volume double precision,
  image_url text,
  is_active boolean,
  sort_order integer
);

CREATE TEMP TABLE tmp_quarries (
  id uuid,
  name text,
  address text,
  lat double precision,
  lon double precision,
  is_active boolean
);

CREATE TEMP TABLE tmp_quarry_materials (
  quarry_id uuid,
  material_id uuid
);

CREATE TEMP TABLE tmp_material_media (
  id uuid,
  entity_type text,
  entity_id uuid,
  bucket text,
  object_key text,
  public_url text,
  content_type text,
  file_name text,
  file_size integer,
  sort_order integer,
  slot_key text,
  is_primary boolean,
  created_at timestamptz
);

\copy tmp_categories FROM '$TMP_DIR/categories.csv' WITH (FORMAT csv)
\copy tmp_materials FROM '$TMP_DIR/materials.csv' WITH (FORMAT csv)
\copy tmp_quarries FROM '$TMP_DIR/quarries.csv' WITH (FORMAT csv)
\copy tmp_quarry_materials FROM '$TMP_DIR/quarry_materials.csv' WITH (FORMAT csv)
\copy tmp_material_media FROM '$TMP_DIR/material_media.csv' WITH (FORMAT csv)

INSERT INTO categories AS c (id, name, slug, sort_order, is_active)
SELECT id, name, slug, sort_order, is_active
FROM tmp_categories
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active;

INSERT INTO materials AS m (
  id, category_id, name, description, price, unit, min_volume, image_url, is_active, sort_order
)
SELECT
  tm.id,
  c.id,
  tm.name,
  tm.description,
  tm.price,
  tm.unit,
  tm.min_volume,
  tm.image_url,
  tm.is_active,
  tm.sort_order
FROM tmp_materials tm
JOIN tmp_categories tc ON tc.id = tm.category_id
JOIN categories c ON c.slug = tc.slug
ON CONFLICT (id) DO UPDATE
SET category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price = EXCLUDED.price,
    unit = EXCLUDED.unit,
    min_volume = EXCLUDED.min_volume,
    image_url = EXCLUDED.image_url,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order;

INSERT INTO quarries AS q (id, name, address, lat, lon, is_active)
SELECT id, name, address, lat, lon, is_active
FROM tmp_quarries
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    address = EXCLUDED.address,
    lat = EXCLUDED.lat,
    lon = EXCLUDED.lon,
    is_active = EXCLUDED.is_active;

DELETE FROM quarry_materials qm
USING quarries q
WHERE qm.quarry_id = q.id
  AND q.id IN (SELECT id FROM tmp_quarries);

INSERT INTO quarry_materials (quarry_id, material_id)
SELECT quarry_id, material_id
FROM tmp_quarry_materials
ON CONFLICT DO NOTHING;

DELETE FROM media_files mf
WHERE mf.entity_type = 'material'
  AND mf.entity_id IN (SELECT id FROM tmp_materials)
  AND mf.id NOT IN (SELECT id FROM tmp_material_media);

INSERT INTO media_files AS mf (
  id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at
)
SELECT
  id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at
FROM tmp_material_media
ON CONFLICT (id) DO UPDATE
SET entity_type = EXCLUDED.entity_type,
    entity_id = EXCLUDED.entity_id,
    bucket = EXCLUDED.bucket,
    object_key = EXCLUDED.object_key,
    public_url = EXCLUDED.public_url,
    content_type = EXCLUDED.content_type,
    file_name = EXCLUDED.file_name,
    file_size = EXCLUDED.file_size,
    sort_order = EXCLUDED.sort_order,
    slot_key = EXCLUDED.slot_key,
    is_primary = EXCLUDED.is_primary,
    created_at = EXCLUDED.created_at;

UPDATE materials
SET is_active = FALSE
WHERE is_active = TRUE
  AND id NOT IN (SELECT id FROM tmp_materials);

UPDATE quarries
SET is_active = FALSE
WHERE is_active = TRUE
  AND id NOT IN (SELECT id FROM tmp_quarries);

COMMIT;
SQL

unset PGPASSWORD

echo "Catalog sync completed."