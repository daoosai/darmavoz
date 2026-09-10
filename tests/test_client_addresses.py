from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.models import City, Client, ClientAddress
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

    async with session_factory() as session:
        second_city = City(
            name="Екатеринбург",
            region="Свердловская область",
            code=f"address-test-{uuid4().hex}",
            center_lat=56.838,
            center_lon=60.597,
            map_zoom=11,
            min_lat=56.6,
            min_lon=60.3,
            max_lat=57.1,
            max_lon=60.9,
            is_active=True,
        )
        session.add(second_city)
        await session.commit()
        await session.refresh(second_city)

    create_third = await client.post(
        "/api/v1/client/addresses",
        json={
            "city_id": str(second_city.id),
            "full_address": "Екатеринбург, Ленина 1",
            "comment": "Другой город",
        },
        headers=headers,
    )
    assert create_third.status_code == 201
    third_payload = create_third.json()
    assert third_payload["id"] not in {first_payload["id"], second_payload["id"]}
    assert third_payload["city_id"] == str(second_city.id)

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
    assert len(payload) == 3
    addresses_by_id = {address["id"]: address for address in payload}
    assert set(addresses_by_id) == {
        first_payload["id"],
        second_payload["id"],
        third_payload["id"],
    }
    assert addresses_by_id[first_payload["id"]]["is_default"] is True
    assert addresses_by_id[second_payload["id"]]["is_default"] is False
    assert addresses_by_id[third_payload["id"]]["full_address"] == "Екатеринбург, Ленина 1"
    assert addresses_by_id[third_payload["id"]]["is_default"] is True

    delete_response = await client.delete(f"/api/v1/client/addresses/{first_payload['id']}", headers=headers)
    assert delete_response.status_code == 204

    async with session_factory() as session:
        remaining = list(
            (
                await session.execute(select(ClientAddress).where(ClientAddress.client_id == client_record.id))
            ).scalars().all()
        )

    assert len(remaining) == 2
    remaining_by_id = {str(address.id): address for address in remaining}
    assert remaining_by_id[second_payload["id"]].full_address == "Москва, Арбат 12"
    assert remaining_by_id[second_payload["id"]].comment == "У второго подъезда"
    assert remaining_by_id[second_payload["id"]].is_default is True
    assert remaining_by_id[third_payload["id"]].full_address == "Екатеринбург, Ленина 1"
