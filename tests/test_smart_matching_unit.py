from app.services.smart_matching import SmartMatchingService, haversine_km, normalize_inverse


def test_haversine_returns_expected_equator_distance():
    assert round(haversine_km(0, 0, 0, 1), 1) == 111.2


def test_inverse_normalization_is_stable_for_equal_values():
    assert normalize_inverse([12.0, 12.0, 12.0]) == [1.0, 1.0, 1.0]


def test_inverse_normalization_prefers_shorter_distance():
    assert normalize_inverse([1.0, 2.0, 3.0]) == [1.0, 0.5, 0.0]


def test_tie_breaker_is_deterministic():
    service = SmartMatchingService()
    rows = [
        {"driver_id": "b", "score": 75, "dispatch_priority": 100, "total_distance_km": 5, "last_offer_at": None},
        {"driver_id": "a", "score": 75, "dispatch_priority": 100, "total_distance_km": 5, "last_offer_at": None},
    ]
    assert [row["driver_id"] for row in sorted(rows, key=service._sort_key)] == ["a", "b"]
