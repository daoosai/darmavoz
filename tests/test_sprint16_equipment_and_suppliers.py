import uuid

import pytest
from sqlalchemy import select

from app.models.models import Role, SupportMessage, SupportTicket, User
from app.security.jwt import create_access_token


async def _create_user(session_factory, role_name: str, *, phone: str | None = None):
    async with session_factory() as session:
        role = await session.scalar(select(Role).where(Role.name == role_name))
        if role is None:
            role = Role(name=role_name, description=f"{role_name} role")
            session.add(role)
            await session.flush()
        username = phone or f"{role_name}_{uuid.uuid4().hex[:10]}"
        user = User(
            username=username,
            display_name=f"{role_name} user",
            hashed_password="not-used",
            role_id=role.id,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = create_access_token({"sub": user.username, "role": role_name})
        return user, token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_custom_equipment_supplier_moderation_and_legacy_compatibility(
    client, session_factory, monkeypatch
):
    sent_emails: list[dict[str, str]] = []
    moderation_notifications: list[dict[str, object]] = []
    monkeypatch.setattr(
        "app.api.equipment.send_email",
        lambda **kwargs: sent_emails.append(kwargs),
    )
    monkeypatch.setattr("app.api.equipment.settings.ADMIN_EMAIL", "admin@example.test")
    monkeypatch.setattr(
        "app.api.equipment.schedule_equipment_listing_moderation_notification",
        lambda listing, is_resubmission=False: moderation_notifications.append(
            {
                "listing_id": listing.id,
                "is_resubmission": is_resubmission,
            }
        ),
    )

    admin, admin_token = await _create_user(session_factory, "admin")
    _logist, logist_token = await _create_user(session_factory, "logist")
    supplier, supplier_token = await _create_user(
        session_factory, "supplier", phone="+79995551001"
    )
    _other_supplier, other_supplier_token = await _create_user(
        session_factory, "supplier", phone="+79995551002"
    )

    type_response = await client.post(
        "/api/v1/admin/equipment-types",
        headers=_headers(admin_token),
        json={"name": "Автокран", "is_active": True, "sort_order": 10},
    )
    assert type_response.status_code == 201
    type_id = type_response.json()["id"]

    legacy_listing_response = await client.post(
        "/api/v1/admin/equipment",
        headers=_headers(admin_token),
        json={
            "equipment_type_id": type_id,
            "title": "Операторский автокран",
            "description": "Обратная совместимость старого API",
            "tariffs": [{"type": "hour", "price": 5000}],
        },
    )
    assert legacy_listing_response.status_code == 201
    legacy_listing = legacy_listing_response.json()
    assert legacy_listing["equipment_type"] == "Автокран"
    assert legacy_listing["equipment_type_id"] == type_id
    assert legacy_listing["moderation_status"] == "approved"

    supplier_listing_response = await client.post(
        "/api/v1/supplier/equipment",
        headers=_headers(supplier_token),
        json={
            "equipment_type": "Гусеничный мульчер",
            "title": "Мульчер для расчистки",
            "description": "Произвольный тип техники поставщика",
            "tariffs": [{"type": "hour", "price": 6500}],
            "city": "Тюмень",
        },
    )
    assert supplier_listing_response.status_code == 201
    supplier_listing = supplier_listing_response.json()
    listing_id = supplier_listing["id"]
    assert supplier_listing["equipment_type_id"] is None
    assert supplier_listing["owner_user_id"] == str(supplier.id)
    assert supplier_listing["moderation_status"] == "pending_moderation"
    assert sent_emails == [
        {
            "to_email": "admin@example.test",
            "subject": "Объявление спецтехники ожидает модерации",
            "body": 'Поставщик добавил объявление: Гусеничный мульчер "Мульчер для расчистки". Требуется проверка.',
        }
    ]

    public_before_approval = await client.get("/api/v1/equipment")
    assert public_before_approval.status_code == 200
    assert {item["id"] for item in public_before_approval.json()} == {
        legacy_listing["id"]
    }

    foreign_update = await client.patch(
        f"/api/v1/supplier/equipment/{listing_id}",
        headers=_headers(other_supplier_token),
        json={"title": "Чужое изменение"},
    )
    assert foreign_update.status_code == 404

    approve_response = await client.post(
        f"/api/v1/admin/equipment/{listing_id}/approve",
        headers=_headers(logist_token),
        json={},
    )
    assert approve_response.status_code == 200
    assert approve_response.json()["moderation_status"] == "approved"

    public_after_approval = await client.get(f"/api/v1/equipment/{listing_id}")
    assert public_after_approval.status_code == 200

    supplier_edit = await client.patch(
        f"/api/v1/supplier/equipment/{listing_id}",
        headers=_headers(supplier_token),
        json={"title": "Мульчер после изменения"},
    )
    assert supplier_edit.status_code == 200
    assert supplier_edit.json()["moderation_status"] == "has_pending_changes"
    assert supplier_edit.json()["moderation_comment"] is None
    assert supplier_edit.json()["pending_changes"]["title"] == "Мульчер после изменения"
    assert sent_emails[-1]["to_email"] == "admin@example.test"
    assert "title" in sent_emails[-1]["body"]
    assert moderation_notifications[-1] == {
        "listing_id": uuid.UUID(listing_id),
        "is_resubmission": True,
    }
    _ = {
        "to_email": "admin@example.test",
        "subject": "Объявление спецтехники ожидает модерации",
        "body": 'Поставщик изменил объявление: Гусеничный мульчер "Мульчер после изменения". Требуется проверка.',
    }

    hidden_after_edit = await client.get(f"/api/v1/equipment/{listing_id}")
    assert hidden_after_edit.status_code == 200
    assert hidden_after_edit.json()["title"] == "Мульчер для расчистки"

    reject_response = await client.post(
        f"/api/v1/admin/equipment/{listing_id}/reject",
        headers=_headers(logist_token),
        json={"reason": "Уточните описание"},
    )
    assert reject_response.status_code == 200
    assert reject_response.json()["moderation_status"] == "approved"
    assert reject_response.json()["pending_changes"] is None
    assert reject_response.json()["moderation_comment"] == "Уточните описание"

    operator_list = await client.get(
        "/api/v1/admin/equipment",
        params={"moderation_status": "approved"},
        headers=_headers(logist_token),
    )
    assert operator_list.status_code == 200
    assert operator_list.json()[0]["owner_phone"] == supplier.username
    assert operator_list.json()[0]["owner_name"] == supplier.display_name
    assert admin.id is not None


@pytest.mark.asyncio
async def test_admin_can_edit_supplier_and_phone_conflicts_are_rejected(
    client, session_factory
):
    _admin, admin_token = await _create_user(session_factory, "admin")
    supplier, supplier_token = await _create_user(
        session_factory, "supplier", phone="+79995552001"
    )
    _occupied, _occupied_token = await _create_user(
        session_factory, "supplier", phone="+79995552002"
    )

    conflict = await client.patch(
        f"/api/v1/admin/suppliers/{supplier.id}",
        headers=_headers(admin_token),
        json={"phone": "+7 (999) 555-20-02"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "SUPPLIER_PHONE_ALREADY_EXISTS"

    update_response = await client.patch(
        f"/api/v1/admin/suppliers/{supplier.id}",
        headers=_headers(admin_token),
        json={
            "full_name": "ООО Новый поставщик",
            "phone": "+7 (999) 555-20-03",
            "is_active": False,
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["full_name"] == "ООО Новый поставщик"
    assert updated["phone"] == "+79995552003"
    assert updated["is_active"] is False

    old_session = await client.get(
        "/api/v1/supplier/me",
        headers=_headers(supplier_token),
    )
    assert old_session.status_code == 401

    empty_update = await client.patch(
        f"/api/v1/admin/suppliers/{supplier.id}",
        headers=_headers(admin_token),
        json={},
    )
    assert empty_update.status_code == 422


@pytest.mark.asyncio
async def test_admin_soft_deletes_supplier_with_hidden_relations_without_500(
    client, session_factory
):
    _admin, admin_token = await _create_user(session_factory, "admin")
    supplier, supplier_token = await _create_user(
        session_factory, "supplier", phone="+79995553001"
    )
    inactive_supplier, _inactive_supplier_token = await _create_user(
        session_factory, "supplier", phone="+79995553002"
    )

    async with session_factory() as session:
      ticket = SupportTicket(
          user_id=supplier.id,
          subject="Проверка удаления",
          category="general",
          context_type="general",
          status="new",
      )
      session.add(ticket)
      await session.flush()
      session.add(
          SupportMessage(
              ticket_id=ticket.id,
              author_user_id=supplier.id,
              text="Связанный лог поддержки",
          )
      )
      db_inactive_supplier = await session.get(User, inactive_supplier.id)
      assert db_inactive_supplier is not None
      db_inactive_supplier.is_active = False
      await session.commit()

    delete_response = await client.delete(
        f"/api/v1/admin/suppliers/{supplier.id}",
        headers=_headers(admin_token),
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["action"] == "archived"

    async with session_factory() as session:
        deleted_supplier = await session.get(User, supplier.id)
        assert deleted_supplier is not None
        assert deleted_supplier.is_active is False
        assert deleted_supplier.is_deleted is True
        assert deleted_supplier.username != "+79995553001"

        preserved_ticket = await session.scalar(
            select(SupportTicket).where(SupportTicket.user_id == supplier.id)
        )
        assert preserved_ticket is not None

    supplier_session = await client.get(
        "/api/v1/supplier/me",
        headers=_headers(supplier_token),
    )
    assert supplier_session.status_code == 401

    list_response = await client.get(
        "/api/v1/admin/suppliers?role=supplier",
        headers=_headers(admin_token),
    )
    assert list_response.status_code == 200
    listed_ids = {item["id"] for item in list_response.json()}
    assert str(supplier.id) not in listed_ids
    assert str(inactive_supplier.id) in listed_ids
