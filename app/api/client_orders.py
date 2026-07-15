from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.models import Client, Order
from app.schemas.order import (
    CheckoutRequest,
    ClientOrderCalculationOut,
    ClientOrderCalculationOptionOut,
    ClientOrderCalculationRequest,
    OrderOut,
)
from app.security.auth import get_optional_current_client
from app.services.dispatch_service import create_checkout_order
from app.services.order_pricing import ClientOrderPricing, calculate_client_order_options

router = APIRouter(prefix="/client/orders")


@router.post("/calculate", response_model=ClientOrderCalculationOut)
async def calculate_order(
    payload: ClientOrderCalculationRequest,
    db: AsyncSession = Depends(get_db),
) -> ClientOrderCalculationOut:
    pricing_options = await calculate_client_order_options(
        db,
        material_id=payload.material_id,
        delivery_option_id=payload.delivery_option_id,
        delivery_lat=payload.delivery_lat,
        delivery_lon=payload.delivery_lon,
        quantity=payload.quantity,
    )

    def serialize_option(pricing: ClientOrderPricing) -> ClientOrderCalculationOptionOut:
        return ClientOrderCalculationOptionOut(
            quarry_id=pricing.quarry.id,
            quarry_name=pricing.quarry.name,
            point_type=pricing.quarry.point_type,
            rating=float(pricing.quarry.rating),
            distance=pricing.mileage_km,
            material_cost=pricing.material_cost,
            delivery_cost=pricing.delivery_cost,
            total_amount=pricing.total_amount,
        )

    return ClientOrderCalculationOut(
        best_option=serialize_option(pricing_options[0]),
        alternatives=[serialize_option(pricing) for pricing in pricing_options[1:]],
    )


@router.post("/checkout", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def checkout_order(
    payload: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    current_client: Client | None = Depends(get_optional_current_client),
) -> Order:
    return await create_checkout_order(
        db,
        client_id=current_client.id if current_client is not None else payload.client_id,
        material_id=payload.material_id,
        delivery_option_id=payload.delivery_option_id,
        delivery_address=payload.delivery_address,
        notes=payload.notes,
        source=payload.source,
        quantity=payload.quantity,
        address_id=payload.address_id,
        quarry_id=payload.quarry_id,
        delivery_lat=payload.delivery_lat,
        delivery_lon=payload.delivery_lon,
        mileage_km=payload.mileage_km,
        expected_material_unit_price=payload.expected_material_unit_price,
    )
