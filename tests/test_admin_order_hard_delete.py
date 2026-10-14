from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text

from app.models.commerce import Payment, PaymentEvent, PaymentQuote, Refund, SettlementReceipt
from app.models.models import (
    Category, Channel, Client, Dialogue, Driver, Material, Order, OrderDistributionHistory,
    OrderEvent, OrderItem, OrderOffer, PushDelivery, Role, User, UserNotification,
)
from app.security.jwt import create_access_token


async def make_order_graph(db, actor, *, payment_status="succeeded", archived=False, remaining_job=False, on_shift=True):
    """No provider requests; use only in an isolated DB or a labeled QA fixture."""
    suffix = uuid4().hex
    client_record = Client(name=f"QA hard delete {suffix}")
    driver = Driver(name=f"QA driver {suffix}", phone=f"qa-{suffix[:16]}", status="busy", is_on_shift=on_shift)
    category = Category(name="QA deletion", slug=f"qa-delete-{suffix}")
    channel = Channel(name="qa-hard-delete", external_account_id=suffix)
    db.add_all([client_record, driver, category, channel])
    await db.flush()
    material = Material(category_id=category.id, name="QA material", description="", price=10, unit="m3", min_volume=1)
    db.add(material)
    await db.flush()
    target = Order(client_id=client_record.id, driver_id=driver.id, address="QA deletion target",
                   status="cancelled" if archived else "driver_assigned", is_deleted=archived, total_amount=10)
    other = Order(client_id=client_record.id, driver_id=driver.id if remaining_job else None,
                  address="QA unrelated order", status="loading" if remaining_job else "created", total_amount=10)
    db.add_all([target, other])
    await db.flush()
    records = []
    for order, label in ((target, "target"), (other, "other")):
        offer = OrderOffer(order_id=order.id, driver_id=driver.id, status="cancelled", price=10, offered_at=datetime.now(UTC))
        dialogue = Dialogue(channel_id=channel.id, external_dialog_id=uuid4().hex, order_id=order.id, status="open")
        quote = PaymentQuote(order_id=order.id, version=1, amount=Decimal("10"), items=[], confirmed_by=actor.id)
        db.add_all([offer, dialogue, quote])
        await db.flush()
        order.current_offer_id = offer.id
        order.source_dialogue_id = dialogue.id
        payment = Payment(order_id=order.id, client_id=client_record.id, quote_id=quote.id, amount=Decimal("10"),
                          idempotence_key=uuid4().hex, status=payment_status if label == "target" else "failed")
        db.add(payment)
        await db.flush()
        children = [
            OrderItem(order_id=order.id, material_id=material.id, quantity=1, volume=1, price=10, amount=10),
            OrderEvent(order_id=order.id, status=order.status, event_type="qa", description="QA"),
            OrderDistributionHistory(order_id=order.id, trigger_source="qa", algorithm_version="qa",
                                     input_snapshot={}, candidates_snapshot=[], distance_source="qa", twogis_status="not_requested"),
            PaymentEvent(payment_id=payment.id, event_type="qa", description="QA"),
            Refund(payment_id=payment.id, amount=Decimal("1"), idempotence_key=uuid4().hex, reason="QA", status="failed"),
            SettlementReceipt(payment_id=payment.id, idempotence_key=uuid4().hex, status="failed"),
            PushDelivery(dedupe_key=uuid4().hex, recipient_type="user", recipient_id=actor.id, event_type="qa",
                         title="QA", body="QA", payload={"order_id": str(order.id)}, status="sent"),
            UserNotification(user_id=actor.id, event_type="qa", title="QA", body="QA", payload={"order_id": str(order.id)}),
        ]
        from app.models.models import EventLog
        children.append(EventLog(order_id=order.id, event_type="qa", description="QA"))
        db.add_all(children)
        await db.flush()
        records.extend((type(obj), obj.id, label) for obj in [order, offer, dialogue, quote, payment, *children])
    await db.commit()
    return dict(target_id=target.id, other_id=other.id, driver_id=driver.id, client_id=client_record.id,
                material_id=material.id, channel_id=channel.id, records=records)


@pytest_asyncio.fixture
async def graph_factory(session_factory):
    async def factory(**kwargs):
        async with session_factory() as db:
            role = await db.scalar(select(Role).where(Role.name == "admin"))
            if role is None:
                role = Role(name="admin")
                db.add(role)
                await db.flush()
            actor = User(username=f"qa_delete_{uuid4().hex}", hashed_password="test-only", role_id=role.id, is_active=True)
            db.add(actor)
            await db.flush()
            graph = await make_order_graph(db, actor, **kwargs)
            graph["headers"] = {"Authorization": "Bearer " + create_access_token({"sub": actor.username})}
            return graph
    return factory


@pytest.mark.asyncio
@pytest.mark.parametrize("payment_status,archived", [("pending", False), ("succeeded", False), ("failed", True)])
async def test_admin_hard_delete_removes_complete_graph(client, session_factory, graph_factory, payment_status, archived):
    graph = await graph_factory(payment_status=payment_status, archived=archived)
    response = await client.delete(f"/api/v1/admin/orders/{graph['target_id']}/hard", headers=graph["headers"])
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
    async with session_factory() as db:
        for model, record_id, label in graph["records"]:
            record = await db.get(model, record_id)
            if label == "other":
                assert record is not None, model.__name__
            elif model is Dialogue:
                assert record is not None and record.order_id is None
            else:
                assert record is None, model.__name__
        assert await db.get(Client, graph["client_id"]) is not None
        assert await db.get(Material, graph["material_id"]) is not None
        assert (await db.get(Driver, graph["driver_id"])).status == "available"
    repeated = await client.delete(f"/api/v1/admin/orders/{graph['target_id']}/hard", headers=graph["headers"])
    assert repeated.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("on_shift,remaining_job,expected", [(False, False, "offline"), (True, True, "busy")])
async def test_hard_delete_respects_other_assignments_and_shift(client, session_factory, graph_factory, on_shift, remaining_job, expected):
    graph = await graph_factory(on_shift=on_shift, remaining_job=remaining_job)
    response = await client.delete(f"/api/v1/admin/orders/{graph['target_id']}/hard", headers=graph["headers"])
    assert response.status_code == 200
    async with session_factory() as db:
        assert (await db.get(Driver, graph["driver_id"])).status == expected


@pytest.mark.asyncio
async def test_hard_delete_fk_conflict_rolls_back_every_change(client, session_factory, graph_factory):
    graph = await graph_factory()
    async with session_factory() as db:
        await db.execute(text("CREATE TABLE qa_hard_delete_blocker (order_id uuid REFERENCES orders(id))"))
        await db.execute(text("INSERT INTO qa_hard_delete_blocker VALUES (:order_id)"), {"order_id": graph["target_id"]})
        await db.commit()
    try:
        response = await client.delete(f"/api/v1/admin/orders/{graph['target_id']}/hard", headers=graph["headers"])
        assert response.status_code == 409
        assert "Изменения отменены" in response.json()["detail"]
        async with session_factory() as db:
            for model, record_id, label in graph["records"]:
                record = await db.get(model, record_id)
                assert record is not None, model.__name__
                if model is Dialogue and label == "target":
                    assert record.order_id == graph["target_id"]
            order = await db.get(Order, graph["target_id"])
            assert order.status == "driver_assigned" and not order.is_deleted
            assert order.current_offer_id is not None and order.source_dialogue_id is not None
            assert (await db.get(Driver, graph["driver_id"])).status == "busy"
    finally:
        async with session_factory() as db:
            await db.execute(text("DROP TABLE qa_hard_delete_blocker"))
            await db.commit()


@pytest.mark.asyncio
async def test_hard_delete_requires_admin(client, session_factory, graph_factory):
    graph = await graph_factory()
    assert (await client.delete(f"/api/v1/admin/orders/{graph['target_id']}/hard")).status_code == 401
    async with session_factory() as db:
        role = await db.scalar(select(Role).where(Role.name == "logist"))
        if role is None:
            role = Role(name="logist")
            db.add(role)
            await db.flush()
        user = User(username=f"qa_logist_{uuid4().hex}", hashed_password="test-only", role_id=role.id, is_active=True)
        db.add(user)
        await db.commit()
        token = create_access_token({"sub": user.username})
    forbidden = await client.delete(f"/api/v1/admin/orders/{graph['target_id']}/hard", headers={"Authorization": "Bearer " + token})
    assert forbidden.status_code == 403
    async with session_factory() as db:
        assert await db.get(Order, graph["target_id"]) is not None
