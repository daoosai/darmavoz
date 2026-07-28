from app.schemas.quarry import QuarryCreate
from app.schemas.supplier import SupplierProfileUpdate


def test_quarry_create_accepts_nullable_coordinates():
    payload = {
        "point_type": "quarry",
        "name": "QA Quarry",
        "short_name": "QA Quarry",
        "address": "Tyumen",
        "description": None,
        "lat": None,
        "lon": None,
        "material_offers": [],
    }

    validated = QuarryCreate.model_validate(payload)

    assert validated.lat is None
    assert validated.lon is None


def test_quarry_create_accepts_materials_alias():
    payload = {
        "point_type": "quarry",
        "name": "QA Quarry",
        "short_name": "QA Quarry",
        "address": "Tyumen",
        "description": None,
        "materials": [
            {
                "material_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "price": 2500,
            }
        ],
    }

    validated = QuarryCreate.model_validate(payload)

    assert validated.materials is not None
    assert validated.material_offers is not None
    assert str(validated.materials[0].material_id) == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    assert validated.material_offers[0].price == 2500


def test_supplier_profile_update_accepts_display_name():
    validated = SupplierProfileUpdate.model_validate({"display_name": "QA Supplier"})

    assert validated.display_name == "QA Supplier"
