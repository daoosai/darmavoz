from app.core.config import settings
from app.services.storage import normalize_public_url


def test_normalize_public_url_rewrites_legacy_nip_domain():
    original = settings.S3_PUBLIC_BASE_URL
    settings.S3_PUBLIC_BASE_URL = "https://test.darmavoz.ru"

    try:
        public_url = "https://darmavoz.159.194.236.11.nip.io/darmavoz-media-test/test/vehicles/car.png"

        assert (
            normalize_public_url(public_url)
            == "https://test.darmavoz.ru/darmavoz-media-test/test/vehicles/car.png"
        )
    finally:
        settings.S3_PUBLIC_BASE_URL = original


def test_normalize_public_url_keeps_non_legacy_domain():
    original = settings.S3_PUBLIC_BASE_URL
    settings.S3_PUBLIC_BASE_URL = "https://test.darmavoz.ru"

    try:
        public_url = "https://cdn.example.com/darmavoz-media-test/test/vehicles/car.png"

        assert normalize_public_url(public_url) == public_url
    finally:
        settings.S3_PUBLIC_BASE_URL = original
