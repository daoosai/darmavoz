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
  "select qm.quarry_id, c.slug, m.name from quarry_materials qm join materials m on m.id = qm.material_id join categories c on c.id = m.category_id order by qm.quarry_id, c.slug, m.name" \
  "$TMP_DIR/quarry_materials.csv"

export_from_prod \
  "select id, capacity_m3, title, description, base_price, delivery_rate_per_km, min_delivery_price, is_active, sort_order, image_url from delivery_options order by sort_order, capacity_m3, title" \
  "$TMP_DIR/delivery_options.csv"

export_from_prod \
  "select id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at from media_files where entity_type = 'material' order by entity_id, sort_order, created_at" \
  "$TMP_DIR/material_media.csv"

export_from_prod \
  "select id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at from media_files where entity_type = 'delivery_option' order by entity_id, sort_order, created_at" \
  "$TMP_DIR/delivery_option_media.csv"

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
  category_slug text,
  material_name text
);

CREATE TEMP TABLE tmp_delivery_options (
  id uuid,
  capacity_m3 double precision,
  title text,
  description text,
  base_price double precision,
  delivery_rate_per_km double precision,
  min_delivery_price double precision,
  is_active boolean,
  sort_order integer,
  image_url text
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

CREATE TEMP TABLE tmp_delivery_option_media (
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
\copy tmp_delivery_options FROM '$TMP_DIR/delivery_options.csv' WITH (FORMAT csv)
\copy tmp_material_media FROM '$TMP_DIR/material_media.csv' WITH (FORMAT csv)
\copy tmp_delivery_option_media FROM '$TMP_DIR/delivery_option_media.csv' WITH (FORMAT csv)

INSERT INTO categories AS c (id, name, slug, sort_order, is_active)
SELECT id, name, slug, sort_order, is_active
FROM tmp_categories
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active;

UPDATE materials existing
SET category_id = c.id,
    description = tm.description,
    price = tm.price,
    unit = tm.unit,
    min_volume = tm.min_volume,
    image_url = tm.image_url,
    is_active = tm.is_active,
    sort_order = tm.sort_order
FROM tmp_materials tm
JOIN tmp_categories tc ON tc.id = tm.category_id
JOIN categories c ON c.slug = tc.slug
WHERE existing.name = tm.name
  AND existing.category_id = c.id;

INSERT INTO materials AS m (
  id, category_id, name, description, price, unit, min_volume, image_url, is_active, sort_order
)
SELECT tm.id, c.id, tm.name, tm.description, tm.price, tm.unit, tm.min_volume, tm.image_url, tm.is_active, tm.sort_order
FROM tmp_materials tm
JOIN tmp_categories tc ON tc.id = tm.category_id
JOIN categories c ON c.slug = tc.slug
WHERE NOT EXISTS (
  SELECT 1
  FROM materials existing
  WHERE existing.name = tm.name
    AND existing.category_id = c.id
)
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

INSERT INTO delivery_options AS d (
  id, capacity_m3, title, description, base_price, delivery_rate_per_km, min_delivery_price, is_active, sort_order, image_url
)
SELECT id, capacity_m3, title, description, base_price, delivery_rate_per_km, min_delivery_price, is_active, sort_order, image_url
FROM tmp_delivery_options
ON CONFLICT (id) DO UPDATE
SET capacity_m3 = EXCLUDED.capacity_m3,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    base_price = EXCLUDED.base_price,
    delivery_rate_per_km = EXCLUDED.delivery_rate_per_km,
    min_delivery_price = EXCLUDED.min_delivery_price,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    image_url = EXCLUDED.image_url;

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
SELECT DISTINCT tqm.quarry_id, m.id
FROM tmp_quarry_materials tqm
JOIN categories c ON c.slug = tqm.category_slug
JOIN materials m ON m.category_id = c.id AND m.name = tqm.material_name
ON CONFLICT DO NOTHING;

DELETE FROM media_files mf
WHERE mf.entity_type = 'material'
  AND mf.entity_id IN (SELECT id FROM tmp_materials)
  AND mf.id NOT IN (SELECT id FROM tmp_material_media);

INSERT INTO media_files AS mf (
  id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at
)
SELECT id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at
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

DELETE FROM media_files mf
WHERE mf.entity_type = 'delivery_option'
  AND mf.entity_id IN (SELECT id FROM tmp_delivery_options)
  AND mf.id NOT IN (SELECT id FROM tmp_delivery_option_media);

INSERT INTO media_files AS mf (
  id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at
)
SELECT id, entity_type, entity_id, bucket, object_key, public_url, content_type, file_name, file_size, sort_order, slot_key, is_primary, created_at
FROM tmp_delivery_option_media
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

UPDATE categories
SET is_active = FALSE
WHERE is_active = TRUE
  AND slug NOT IN (SELECT slug FROM tmp_categories);

UPDATE delivery_options
SET is_active = FALSE
WHERE is_active = TRUE
  AND id NOT IN (SELECT id FROM tmp_delivery_options);

UPDATE quarries
SET is_active = FALSE
WHERE is_active = TRUE
  AND id NOT IN (SELECT id FROM tmp_quarries);

COMMIT;
SQL

unset PGPASSWORD

echo "Catalog sync completed."
