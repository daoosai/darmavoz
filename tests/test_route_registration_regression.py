import os


def test_supplier_and_admin_routes_registered():
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/db")
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
    os.environ.setdefault("SECRET_KEY", "test-secret-key")
    os.environ.setdefault("ALGORITHM", "HS256")
    os.environ.setdefault("ADMIN_USERNAME", "admin")
    os.environ.setdefault("ADMIN_PASSWORD", "password")
    os.environ.setdefault("AVITO_WEBHOOK_SECRET", "secret")

    from main import app

    route_map: dict[str, set[str]] = {}
    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if not path or not methods:
            continue
        route_map.setdefault(path, set()).update(methods)

    assert "GET" in route_map.get("/api/v1/supplier/equipment", set())
    assert "POST" in route_map.get("/api/v1/supplier/equipment", set())
    assert "PATCH" in route_map.get("/api/v1/admin/suppliers/{supplier_id}", set())
    assert "DELETE" in route_map.get("/api/v1/support/tickets/{ticket_id}", set())
