"""Release migration topology and upgrade of the already-deployed staging schema."""
import asyncio

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from tests.conftest import ALEMBIC_INI_PATH, ALEMBIC_SCRIPT_LOCATION, test_database_url


def config():
    cfg = Config(ALEMBIC_INI_PATH)
    cfg.set_main_option("script_location", ALEMBIC_SCRIPT_LOCATION)
    cfg.set_main_option("sqlalchemy.url", test_database_url.render_as_string(hide_password=False))
    return cfg


def test_release_has_one_head_and_preserves_production_ancestry():
    scripts = ScriptDirectory.from_config(config())
    assert scripts.get_heads() == ["s26_subscription_platform"]
    assert scripts.get_revision("s23_transport_tariffs").down_revision == "de1cd3718448"
    assert scripts.get_revision("s23_parser_material_in_progress").down_revision == "s22_publish_parser_cities"


@pytest.mark.asyncio
async def test_existing_staging_transport_is_preserved_on_branch_merge(session_factory):
    # Reproduce the former staging schema, rather than leaving new S26 tables with an old marker.
    await asyncio.to_thread(command.downgrade, config(), "release_317_merge_heads")
    async with session_factory() as db:
        before = (await db.execute(text("SELECT id, slug FROM transport_categories ORDER BY slug"))).all()
        assert {r.slug for r in before} >= {"small", "medium", "large"}
        # Simulate the former staging marker; its transport tables are already real.
        await db.execute(text("UPDATE alembic_version SET version_num = 'refunds_durable_queue'"))
        await db.commit()
    await asyncio.to_thread(command.upgrade, config(), "head")
    async with session_factory() as db:
        after = (await db.execute(text("SELECT id, slug FROM transport_categories ORDER BY slug"))).all()
        assert after == before
        assert (await db.scalars(text("SELECT version_num FROM alembic_version"))).all() == ["s26_subscription_platform"]
