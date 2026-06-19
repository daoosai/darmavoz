import pytest
from sqlalchemy import select

from app.models.models import Client, ClientAddress
from app.security.jwt import create_access_token


def client_auth_headers(*, email: str, client_id) -> dict[str, str]:
    token = create_access_token(data={"sub": email, "role": "client", "client_id": str(client_id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_client_addresses_crud_and_default_rotation(client, session_factory):
    async with session_factory() as session:
        client_record = Client(name="Address Client", email="addr@example.com", phone="+79990002020")
        session.add(client_record)
        await session.commit()
        await session.refresh(client_record)

    headers = client_auth_headers(email="addr@example.com", client_id=client_record.id)

    create_first = await client.post(
        "/api/v1/client/addresses",
        json={
            "full_address": "Москва, Тверская 1",
            "comment": "Возле красных ворот",
            "lat": 55.75,
            "lon": 37.61,
        },
        headers=headers,
    )
    assert create_first.status_code == 201
    first_payload = create_first.json()
    assert first_payload["is_default"] is True
    assert first_payload["comment"] == "Возле красных ворот"

    create_second = await client.post(
        "/api/v1/client/addresses",
        json={"full_address": "Москва, Арбат 10", "comment": "Под шлагбаум", "is_default": True},
        headers=headers,
    )
    assert create_second.status_code == 201
    second_payload = create_second.json()
    assert second_payload["is_default"] is True

    update_second = await client.put(
        f"/api/v1/client/addresses/{second_payload['id']}",
        json={
            "full_address": "Москва, Арбат 12",
            "comment": "У второго подъезда",
            "lat": 55.7522,
            "lon": 37.595,
        },
        headers=headers,
    )
    assert update_second.status_code == 200
    updated_payload = update_second.json()
    assert updated_payload["full_address"] == "Москва, Арбат 12"
    assert updated_payload["comment"] == "У второго подъезда"

    set_default = await client.patch(f"/api/v1/client/addresses/{first_payload['id']}/default", headers=headers)
    assert set_default.status_code == 200
    assert set_default.json()["is_default"] is True

    list_response = await client.get("/api/v1/client/addresses", headers=headers)
    assert list_response.status_code == 200
    payload = list_response.json()
    assert len(payload) == 2
    assert payload[0]["id"] == first_payload["id"]
    assert payload[0]["is_default"] is True
    assert payload[1]["is_default"] is False

    delete_response = await client.delete(f"/api/v1/client/addresses/{first_payload['id']}", headers=headers)
    assert delete_response.status_code == 204

    async with session_factory() as session:
        remaining = list(
            (
                await session.execute(select(ClientAddress).where(ClientAddress.client_id == client_record.id))
            ).scalars().all()
        )

    assert len(remaining) == 1
    assert remaining[0].full_address == "Москва, Арбат 12"
    assert remaining[0].comment == "У второго подъезда"
    assert remaining[0].is_default is True
