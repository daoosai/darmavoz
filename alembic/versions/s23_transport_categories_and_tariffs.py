"""Sprint 23 transport categories, city tariffs, and delivery snapshots.

The migration is additive: legacy delivery options and completed orders retain their
identifiers and pricing fields. Existing global rates are copied into one open-ended
city tariff for the most capacious active option in every core category.
"""

from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "s23_transport_tariffs"
down_revision = "s22_publish_parser_cities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    categories = op.create_table(
        "transport_categories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("capacity_min_m3", sa.Float(), nullable=False),
        sa.Column("capacity_max_m3", sa.Float(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint("capacity_min_m3 > 0", name="ck_transport_category_capacity_min"),
        sa.CheckConstraint(
            "capacity_max_m3 IS NULL OR capacity_max_m3 >= capacity_min_m3",
            name="ck_transport_category_capacity_range",
        ),
    )
    tariffs = op.create_table(
        "delivery_tariffs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column(
            "transport_category_id",
            UUID(as_uuid=True),
            sa.ForeignKey("transport_categories.id"),
            nullable=False,
        ),
        sa.Column("distance_from_km", sa.Float(), nullable=False),
        sa.Column("distance_to_km", sa.Float(), nullable=True),
        sa.Column("rate_per_km", sa.Float(), nullable=False),
        sa.Column("min_price_quarry", sa.Float(), nullable=False),
        sa.Column("min_price_warehouse", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint("distance_from_km >= 0", name="ck_delivery_tariff_distance_from"),
        sa.CheckConstraint(
            "distance_to_km IS NULL OR distance_to_km > distance_from_km",
            name="ck_delivery_tariff_distance_range",
        ),
        sa.CheckConstraint("rate_per_km >= 0", name="ck_delivery_tariff_rate"),
        sa.CheckConstraint("min_price_quarry >= 0", name="ck_delivery_tariff_min_quarry"),
        sa.CheckConstraint("min_price_warehouse >= 0", name="ck_delivery_tariff_min_warehouse"),
        sa.UniqueConstraint(
            "city_id", "transport_category_id", "distance_from_km",
            name="uq_delivery_tariff_city_category_from",
        ),
    )
    op.create_index("ix_delivery_tariffs_city_id", "delivery_tariffs", ["city_id"])
    op.create_index("ix_delivery_tariffs_transport_category_id", "delivery_tariffs", ["transport_category_id"])
    op.create_index(
        "ix_delivery_tariff_lookup",
        "delivery_tariffs",
        ["city_id", "transport_category_id", "is_active", "distance_from_km"],
    )

    op.add_column("delivery_options", sa.Column("transport_category_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_delivery_options_transport_category",
        "delivery_options",
        "transport_categories",
        ["transport_category_id"],
        ["id"],
    )
    op.create_index("ix_delivery_options_transport_category_id", "delivery_options", ["transport_category_id"])

    op.add_column("vehicles", sa.Column("transport_category_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_vehicles_transport_category",
        "vehicles",
        "transport_categories",
        ["transport_category_id"],
        ["id"],
    )
    op.create_index("ix_vehicles_transport_category_id", "vehicles", ["transport_category_id"])

    op.add_column("orders", sa.Column("transport_category_id", UUID(as_uuid=True), nullable=True))
    op.add_column("orders", sa.Column("delivery_tariff_id", UUID(as_uuid=True), nullable=True))
    op.add_column("orders", sa.Column("trip_count", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("trip_capacity_m3_snapshot", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("tariff_distance_from_km_snapshot", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("tariff_distance_to_km_snapshot", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("min_delivery_price_snapshot", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("delivery_cost_per_trip", sa.Float(), nullable=True))
    op.create_foreign_key(
        "fk_orders_transport_category", "orders", "transport_categories",
        ["transport_category_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_orders_delivery_tariff", "orders", "delivery_tariffs",
        ["delivery_tariff_id"], ["id"],
    )

    category_rows = [
        {
            "id": uuid4(), "slug": "small", "title": "Малые машины",
            "capacity_min_m3": 1.0, "capacity_max_m3": 5.0, "sort_order": 10,
        },
        {
            "id": uuid4(), "slug": "medium", "title": "Средние машины",
            "capacity_min_m3": 6.0, "capacity_max_m3": 17.0, "sort_order": 20,
        },
        {
            "id": uuid4(), "slug": "large", "title": "Большие самосвалы",
            "capacity_min_m3": 18.0, "capacity_max_m3": None, "sort_order": 30,
        },
    ]
    op.bulk_insert(categories, category_rows)
    category_ids = {row["slug"]: row["id"] for row in category_rows}

    bind = op.get_bind()
    for slug, predicate in (
        ("small", "capacity_m3 >= 1 AND capacity_m3 <= 5"),
        ("medium", "capacity_m3 > 5 AND capacity_m3 <= 17"),
        ("large", "capacity_m3 > 17"),
    ):
        bind.execute(
            sa.text(f"UPDATE delivery_options SET transport_category_id = :category_id WHERE {predicate}"),
            {"category_id": category_ids[slug]},
        )

    bind.execute(sa.text("""
        UPDATE vehicles AS vehicle
        SET transport_category_id = option.transport_category_id
        FROM delivery_options AS option
        WHERE vehicle.delivery_option_id = option.id
          AND vehicle.transport_category_id IS NULL
    """))
    for slug, predicate in (
        ("small", "body_volume_m3 >= 1 AND body_volume_m3 <= 5"),
        ("medium", "body_volume_m3 > 5 AND body_volume_m3 <= 17"),
        ("large", "body_volume_m3 > 17"),
    ):
        bind.execute(
            sa.text(f"""
                UPDATE vehicles
                SET transport_category_id = :category_id
                WHERE transport_category_id IS NULL AND {predicate}
            """),
            {"category_id": category_ids[slug]},
        )

    option_rows = bind.execute(sa.text("""
        SELECT transport_category_id, capacity_m3, delivery_rate_per_km,
               min_price_quarry, min_price_warehouse
        FROM delivery_options
        WHERE is_active IS TRUE
          AND transport_category_id IS NOT NULL
          AND delivery_rate_per_km IS NOT NULL
        ORDER BY transport_category_id, capacity_m3 DESC
    """)).mappings().all()
    largest_option_by_category = {}
    for row in option_rows:
        largest_option_by_category.setdefault(row["transport_category_id"], row)

    city_ids = [row.id for row in bind.execute(sa.text("SELECT id FROM cities")).all()]
    tariff_rows = []
    for city_id in city_ids:
        for category_id, source in largest_option_by_category.items():
            tariff_rows.append({
                "id": uuid4(),
                "city_id": city_id,
                "transport_category_id": category_id,
                "distance_from_km": 0.0,
                "distance_to_km": None,
                "rate_per_km": float(source["delivery_rate_per_km"]),
                "min_price_quarry": float(source["min_price_quarry"]),
                "min_price_warehouse": float(source["min_price_warehouse"]),
                "is_active": True,
                "sort_order": 0,
            })
    if tariff_rows:
        op.bulk_insert(tariffs, tariff_rows)


def downgrade() -> None:
    raise RuntimeError(
        "Sprint 23 stores delivery pricing snapshots. Downgrade requires a separately reviewed data migration."
    )
