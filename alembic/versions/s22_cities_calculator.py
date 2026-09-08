"""Sprint 22: additive city migration and calculator reference data.

Existing records deliberately remain unassigned until the data audit is approved.
"""
from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "s22_cities_calculator"
down_revision = ("b1c2d3e4f5a6", "f9e8d7c6b5a4")
branch_labels = None
depends_on = None

SCOPED_TABLES = (
    "quarries", "water_points", "septic_provider_profiles",
    "special_equipment_listings", "special_equipment_applications",
    "client_addresses", "orders",
)


def upgrade():
    cities = op.create_table(
        "cities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("region", sa.String(255), nullable=False),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("legacy_backfill_completed", sa.Boolean(), nullable=False, server_default="false"),
        *[sa.Column(key, sa.Float(), nullable=False) for key in (
            "center_lat", "center_lon", "map_zoom", "min_lat", "min_lon", "max_lat", "max_lon")],
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("center_lat BETWEEN -90 AND 90 AND center_lon BETWEEN -180 AND 180", name="ck_city_center"),
        sa.CheckConstraint("min_lat >= -90 AND max_lat <= 90 AND min_lat < max_lat AND min_lon >= -180 AND max_lon <= 180 AND min_lon < max_lon", name="ck_city_bounds"),
        sa.CheckConstraint("map_zoom BETWEEN 1 AND 20", name="ck_city_zoom"),
        sa.CheckConstraint("NOT is_default OR is_active", name="ck_city_default_active"),
    )
    op.create_index("uq_city_default", "cities", ["is_default"], unique=True, postgresql_where=sa.text("is_default"))
    op.bulk_insert(cities, [{
        "id": uuid4(), "name": "Тюмень", "region": "Тюменская область", "code": "tyumen",
        "center_lat": 57.152286, "center_lon": 65.534328, "map_zoom": 11,
        "min_lat": 56.95, "min_lon": 65.10, "max_lat": 57.45, "max_lon": 65.95,
        "is_active": True, "is_default": True, "sort_order": 0,
    }])
    for table in SCOPED_TABLES:
        op.add_column(table, sa.Column("city_id", UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(f"fk_{table}_city", table, "cities", ["city_id"], ["id"])
        op.create_index(f"ix_{table}_city_id", table, ["city_id"])
    for table, owner, target in (("user_cities", "user_id", "users"), ("driver_cities", "driver_id", "drivers")):
        op.create_table(table,
            sa.Column(owner, UUID(as_uuid=True), sa.ForeignKey(f"{target}.id"), primary_key=True),
            sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), primary_key=True),
        )
        op.create_index(f"ix_{table}_city_id", table, ["city_id"])
    op.add_column("materials", sa.Column("calculator_enabled", sa.Boolean(), nullable=False, server_default="true"))
    op.add_column("materials", sa.Column("bulk_density_t_m3", sa.Float(), nullable=True))
    op.create_check_constraint("ck_material_density", "materials", "bulk_density_t_m3 > 0 AND bulk_density_t_m3 < 'Infinity'::float8")


def downgrade():
    raise RuntimeError("Sprint 22 downgrade removes city data; use a separately reviewed migration")
