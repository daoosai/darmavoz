import React, { useState, useEffect } from "react";
import {
  ShoppingCart,
  X,
  ImageIcon,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Truck,
} from "lucide-react";
import {
  findDeliveryOptionForVolume,
  getDeliveryOptionsForVolume,
  useAuthStore,
  useCartStore,
  useAddressStore,
} from "./store";
import { baseURL, resolveMediaUrl } from "./utils";
import toast from "react-hot-toast";
import { MaterialProps } from "./MaterialDetailScreen";
import PickupPointMapScreen, { PickupPointSelection } from "./PickupPointMapScreen";

interface MarketplaceOption {
  quarry_id: string;
  quarry_name: string;
  point_type: string;
  distance: number;
  delivery_cost: number;
  material_cost: number;
  total_amount: number;
  primary_image_url?: string | null;
}

interface MarketplaceCalculation {
  best_option: MarketplaceOption;
  alternatives: MarketplaceOption[];
}

type CalculationResult = MarketplaceCalculation | { error: true };

interface MapContext {
  itemId: string;
  material: MaterialProps;
  deliveryOptionId: string;
}

const isMarketplaceCalculation = (
  result: CalculationResult | undefined,
): result is MarketplaceCalculation => Boolean(result && "best_option" in result);

const MIN_VOLUME_M3 = 5;
const VOLUME_STEP_M3 = 1;

const getCartItemVolume = (item: ReturnType<typeof useCartStore.getState>["cartItems"][number]) =>
  Number(item.volume ?? item.deliveryOption.capacity_m3 * item.quantity);

export default function CartScreen({
  onGoToHome,
  onGoToOrders,
  onOpenAuth,
  onOpenAddresses,
}: {
  onGoToHome: () => void;
  onGoToOrders: () => void;
  onOpenAuth: () => void;
  onOpenAddresses: () => void;
}) {
  const {
    cartItems,
    removeFromCart,
    getTotalPrice,
    clearCart,
    updateItemVolume,
  } = useCartStore();
  const { role, token } = useAuthStore();
  const { selectedAddress, setSelectedAddress } = useAddressStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalAddress, setGlobalAddress] = useState(selectedAddress);
  const [calcResults, setCalcResults] = useState<Record<string, CalculationResult>>({});
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [preferredPointIds, setPreferredPointIds] = useState<Record<string, string>>({});
  const [mapContext, setMapContext] = useState<MapContext | null>(null);
  const [draftVolumes, setDraftVolumes] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!token || role !== "client") {
      onOpenAuth();
      onGoToHome();
    }
  }, [token, role, onOpenAuth, onGoToHome]);

  useEffect(() => {
    setGlobalAddress(selectedAddress);
  }, [selectedAddress]);

  useEffect(() => {
    setDraftVolumes((current) => {
      const next: Record<string, number> = {};
      cartItems.forEach((item) => {
        next[item.id] = current[item.id] ?? getCartItemVolume(item);
      });
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      const isUnchanged =
        currentKeys.length === nextKeys.length &&
        nextKeys.every((key) => current[key] === next[key]);
      return isUnchanged ? current : next;
    });
  }, [cartItems]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      cartItems.forEach((item) => {
        const draftVolume = draftVolumes[item.id];
        if (draftVolume == null || draftVolume === getCartItemVolume(item)) return;
        updateItemVolume(item.id, draftVolume);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [cartItems, draftVolumes, updateItemVolume]);

  const changeDraftVolume = (
    item: ReturnType<typeof useCartStore.getState>["cartItems"][number],
    direction: number,
  ) => {
    const deliveryOptions = getDeliveryOptionsForVolume([
      item.deliveryOption,
      ...(item.material.delivery_options || []),
    ]);
    const maxVolume = Number(deliveryOptions.at(-1)?.capacity_m3 || MIN_VOLUME_M3);
    const currentVolume = draftVolumes[item.id] ?? getCartItemVolume(item);
    const nextVolume = Math.min(
      maxVolume,
      Math.max(MIN_VOLUME_M3, currentVolume + direction * VOLUME_STEP_M3),
    );
    if (
      nextVolume === currentVolume ||
      !findDeliveryOptionForVolume(deliveryOptions, nextVolume)
    ) {
      return;
    }
    setDraftVolumes((current) => ({ ...current, [item.id]: nextVolume }));
  };

  useEffect(() => {
    const calculateDelivery = async () => {
      if (
        cartItems.length === 0 ||
        !globalAddress.trim() ||
        role !== "client"
      ) {
        setCalcResults({});
        return;
      }

      setIsCalculating(true);
      try {
        // Geocode address first
        const geoRes = await fetch(
          `${baseURL}/geo/geocode?address=${encodeURIComponent(globalAddress)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!geoRes.ok) throw new Error("Geocode error");

        const geoData = await geoRes.json();
        const { lat, lon } = geoData;
        setDeliveryCoords({ lat, lon });

        // Fetch calculation for each item
        const newResults: Record<string, CalculationResult> = {};
        for (const item of cartItems) {
          const res = await fetch(`${baseURL}/client/orders/calculate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              material_id: item.material.id,
              delivery_option_id: item.deliveryOption.id,
              delivery_lat: lat,
              delivery_lon: lon,
              quantity: item.quantity,
              quarry_id: preferredPointIds[item.id] || item.pickupPoint?.id || undefined,
            }),
          });
          if (res.ok) {
            newResults[item.id] = await res.json();
          } else {
            newResults[item.id] = { error: true };
          }
        }
        setCalcResults(newResults);
      } catch (e) {
        setDeliveryCoords(null);
        console.error("Calculation error", e);
        // If geocode fails or network fails, we can also set error state
        const errResults: Record<string, CalculationResult> = {};
        for (const item of cartItems) {
          errResults[item.id] = { error: true };
        }
        setCalcResults(errResults);
      } finally {
        setIsCalculating(false);
      }
    };

    const timer = setTimeout(calculateDelivery, 800);
    return () => clearTimeout(timer);
  }, [globalAddress, cartItems, token, role, preferredPointIds]);

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGlobalAddress(e.target.value);
    setSelectedAddress(e.target.value);
  };

  const selectMarketplaceOption = (itemId: string, selected: MarketplaceOption) => {
    setPreferredPointIds((current) => ({
      ...current,
      [itemId]: selected.quarry_id,
    }));
    setCalcResults((currentResults) => {
      const current = currentResults[itemId];
      if (!isMarketplaceCalculation(current)) return currentResults;
      const allOptions = [current.best_option, ...current.alternatives];
      return {
        ...currentResults,
        [itemId]: {
          best_option: selected,
          alternatives: allOptions.filter((option) => option.quarry_id !== selected.quarry_id),
        },
      };
    });
  };

  const selectPointFromMap = (point: PickupPointSelection) => {
    if (!mapContext) return;
    const supportsSelectedVehicle = point.delivery_options?.some(
      (option) => option.id === mapContext.deliveryOptionId,
    );
    if (!supportsSelectedVehicle) {
      toast.error("Для этой точки выбранная машина недоступна");
      return;
    }
    setPreferredPointIds((current) => ({
      ...current,
      [mapContext.itemId]: point.id,
    }));
    setMapContext(null);
    toast.success("Точка выбрана, пересчитываем стоимость");
  };

  const handleCheckout = async () => {
    if (cartItems.length === 0 || !globalAddress.trim()) return;

    if (role !== "client") {
      onOpenAuth();
      return;
    }

    try {
      setIsSubmitting(true);

      const requests = cartItems.map((item) => {
        const calculation = calcResults[item.id];
        const selectedOption = isMarketplaceCalculation(calculation)
          ? calculation.best_option
          : null;
        const orderedVolume = item.deliveryOption.capacity_m3 * item.quantity;
        const expectedMaterialUnitPrice = selectedOption && orderedVolume > 0
          ? selectedOption.material_cost / orderedVolume
          : item.pickupPoint?.price;
        return fetch(`${baseURL}/orders/checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            material_id: item.material.id,
            delivery_option_id: item.deliveryOption.id,
            address: globalAddress,
            notes: item.comment || "",
            source: "web",
            quantity: item.quantity,
            quarry_id: selectedOption?.quarry_id || item.pickupPoint?.id,
            mileage_km: selectedOption?.distance,
            delivery_lat: deliveryCoords?.lat,
            delivery_lon: deliveryCoords?.lon,
            expected_material_unit_price: expectedMaterialUnitPrice,
          }),
        });
      });

      const responses = await Promise.all(requests);
      const hasErrors = responses.some((res) => !res.ok);

      if (!hasErrors) {
        toast.success("Заказ успешно оформлен");
        clearCart();
        setGlobalAddress("");
        onGoToOrders();
      } else {
        alert(
          "Некоторые заказы не удалось оформить. Пожалуйста, попробуйте еще раз.",
        );
      }
    } catch (err) {
      console.error(err);
      alert("Сетевая ошибка при оформлении заказа.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalMaterialCost = getTotalPrice();
  const hasCalculations = Object.keys(calcResults).length > 0;
  const hasCalculationError = hasCalculations && cartItems.some(
    (item) => !isMarketplaceCalculation(calcResults[item.id]),
  );

  const totalDeliveryCost = cartItems.reduce((acc, item) => {
    const res = calcResults[item.id];
    return acc + (isMarketplaceCalculation(res) ? Number(res.best_option.delivery_cost) || 0 : 0);
  }, 0);

  const finalTotal = Math.round(
    hasCalculations && !isCalculating && !hasCalculationError
      ? cartItems.reduce((acc, item) => {
          const res = calcResults[item.id];
          if (!isMarketplaceCalculation(res)) return acc;
          return acc + (Number(res.best_option.total_amount) || 0);
        }, 0)
      : totalMaterialCost,
  );
  const cartItemGroups = Object.values(
    cartItems.reduce<Record<string, (typeof cartItems)[number][]>>((groups, item) => {
      const materialId = item.material.id;
      groups[materialId] = [...(groups[materialId] || []), item];
      return groups;
    }, {}),
  );

  if (!token || role !== "client") {
    return null;
  }

  if (cartItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-68px)] w-full p-6 bg-white overflow-hidden">
        <div className="w-20 h-20 bg-slate-100 rounded-[28px] flex items-center justify-center mb-5 border border-slate-200">
          <ShoppingCart className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">
          Добавьте товары в корзину
        </h3>
        <p className="text-sm text-slate-500 mb-6 text-center">
          Ваша корзина пуста. Перейдите в каталог, чтобы выбрать материалы для
          доставки.
        </p>
        <button
          onClick={onGoToHome}
          className="bg-[#2DB0E6] text-white px-8 py-3 rounded-full font-medium shadow-sm active:bg-[#209dd0] transition-colors"
        >
          К списку товаров
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-slate-50 pb-56 min-h-[calc(100vh-68px)]">
      <div className="flex-1 p-4 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900 mb-4 pt-2">Корзина</h2>

        {/* List of items */}
        <div className="flex flex-col gap-4 mb-6">
          {cartItems.map((item) => {
            const draftVolume = draftVolumes[item.id] ?? getCartItemVolume(item);
            const deliveryOptions = getDeliveryOptionsForVolume([
              item.deliveryOption,
              ...(item.material.delivery_options || []),
            ]);
            const displayedOption = findDeliveryOptionForVolume(deliveryOptions, draftVolume) || item.deliveryOption;
            const maxVolume = Number(deliveryOptions.at(-1)?.capacity_m3 || displayedOption.capacity_m3);
            const vehicleImageUrl = resolveMediaUrl(
              displayedOption.primary_image_url
                || displayedOption.media_files?.[0]?.public_url
                || displayedOption.image_url,
            );

            return (
              <div
                key={item.id}
                className="flex flex-row items-start rounded-[24px] border border-slate-100 bg-white p-3 shadow-sm"
              >
                <div className="flex h-[80px] w-[80px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-slate-100">
                  {vehicleImageUrl ? (
                    <img
                      src={vehicleImageUrl}
                      alt={displayedOption.title}
                      className="h-full w-full object-contain p-1"
                    />
                  ) : (
                    <Truck className="h-8 w-8 text-slate-300" />
                  )}
                </div>
                <div className="ml-3 flex min-h-[80px] flex-1 flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <h3 className="line-clamp-1 text-[16px] font-bold leading-tight text-slate-900">
                      {item.material?.name}
                    </h3>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="-mr-1 -mt-1 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-50 hover:text-red-500"
                    >
                      <X className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                  </div>

                  <div className="line-clamp-1 text-[14px] text-slate-500">
                    {displayedOption.title} (машина до {displayedOption.capacity_m3} м³)
                  </div>

                  {item.comment && (
                    <div className="mt-0.5 line-clamp-1 text-[13px] italic text-slate-400">
                      {item.comment}
                    </div>
                  )}

                  <div className="mt-2 flex justify-end">
                    <div className="inline-flex items-center rounded-full border border-sky-100 bg-sky-50 p-1">
                      <button
                        type="button"
                        onClick={() => changeDraftVolume(item, -VOLUME_STEP_M3)}
                        disabled={draftVolume <= MIN_VOLUME_M3}
                        aria-label={`Уменьшить объём ${item.material.name}`}
                        className="grid h-7 w-7 place-items-center rounded-full bg-white text-sky-700 shadow-sm transition-colors disabled:cursor-not-allowed disabled:text-slate-300"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-[68px] px-2 text-center text-sm font-bold text-sky-700">
                        {draftVolume} м³
                      </span>
                      <button
                        type="button"
                        onClick={() => changeDraftVolume(item, VOLUME_STEP_M3)}
                        disabled={draftVolume >= maxVolume}
                        aria-label={`Увеличить объём ${item.material.name}`}
                        className="grid h-7 w-7 place-items-center rounded-full bg-white text-sky-700 shadow-sm transition-colors disabled:cursor-not-allowed disabled:text-slate-300"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Global Address Field */}
        <div className="bg-white rounded-[24px] p-4 shadow-sm border border-slate-100 mb-4">
          <h3 className="font-semibold text-slate-800 mb-2 ml-1 text-[15px]">
            Адрес доставки
          </h3>
          <button
            onClick={() => {
              if (role !== "client") {
                onOpenAuth();
              } else {
                onOpenAddresses();
              }
            }}
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-left flex items-center justify-between active:bg-slate-100 transition-colors"
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-[#2DB0E6]/10 flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4 text-[#2DB0E6]" />
              </div>
              <span
                className={`text-[15px] font-medium truncate ${token && role === "client" && globalAddress ? "text-slate-900" : "text-slate-400"}`}
              >
                {token && role === "client" && globalAddress
                  ? globalAddress
                  : "Укажите адрес доставки..."}
              </span>
            </div>
          </button>
        </div>

        {/* Marketplace calculation result */}
        {!globalAddress.trim() ? (
          <div className="p-4 bg-blue-50 text-blue-700 rounded-xl text-sm mt-4">
            💡 Укажите адрес доставки, чтобы мы сравнили цены всех доступных точек.
          </div>
        ) : isCalculating ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-[24px] border border-slate-100 bg-white py-10 shadow-sm">
            <Loader2 className="h-7 w-7 animate-spin text-[#2DB0E6]" />
            <span className="text-sm font-medium text-slate-500">
              Сравниваем доступные варианты...
            </span>
          </div>
        ) : hasCalculationError ? (
          <div className="p-4 bg-orange-50 text-orange-700 rounded-xl text-sm mt-4">
            Доставка этого материала по вашему адресу временно невозможна: подходящие точки не найдены.
          </div>
        ) : hasCalculations ? (
          <div className="flex flex-col gap-5">
            {cartItemGroups.map((group) => {
              const representativeItem = group[0];
              const calculatedItems = group.flatMap((item) => {
                const calculation = calcResults[item.id];
                return isMarketplaceCalculation(calculation)
                  ? [{ item, calculation }]
                  : [];
              });
              if (calculatedItems.length === 0) return null;

              const best = calculatedItems[0].calculation.best_option;
              const pointIds = new Set(
                calculatedItems.map(({ calculation }) => calculation.best_option.quarry_id),
              );
              const totalVolume = group.reduce(
                (sum, item) =>
                  sum +
                  Number(
                    item.volume ?? item.deliveryOption.capacity_m3 * item.quantity,
                  ),
                0,
              );
              const aggregate = calculatedItems.reduce(
                (totals, { calculation }) => ({
                  materialCost: totals.materialCost + calculation.best_option.material_cost,
                  deliveryCost: totals.deliveryCost + calculation.best_option.delivery_cost,
                  totalAmount: totals.totalAmount + calculation.best_option.total_amount,
                }),
                { materialCost: 0, deliveryCost: 0, totalAmount: 0 },
              );
              const groupAlternatives = calculatedItems.flatMap(({ item, calculation }) =>
                calculation.alternatives.map((option) => ({ item, option })),
              );
              const pointTitle = pointIds.size === 1
                ? best.quarry_name
                : `Подобрано точек: ${pointIds.size}`;
              const pointSubtitle = pointIds.size === 1
                ? `${Number(best.distance).toFixed(1)} км от адреса`
                : "Маршрут рассчитан отдельно для каждой машины";
              const bestImageUrl = resolveMediaUrl(best.primary_image_url);

              return (
                <section key={representativeItem.material.id} className="rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-3 px-1">
                    <div>
                      <h3 className="font-bold text-slate-900">{representativeItem.material.name}</h3>
                      <p className="text-xs text-slate-500">
                        {totalVolume} м³ · {group.map((item) => item.deliveryOption.title).join(", ")}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border-2 border-sky-500 bg-white p-4 text-slate-900 shadow-sm">
                    <div className="mb-3 inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-sky-700">
                      Выгодный вариант
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate text-lg font-black leading-tight">{pointTitle}</h4>
                        <p className="mt-1 text-sm text-slate-500">{pointSubtitle}</p>
                      </div>
                      {pointIds.size === 1 && (
                        <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700">
                          {best.point_type === "quarry" ? "Карьер" : "Накопитель"}
                        </span>
                      )}
                    </div>
                    <div className="mt-4 grid h-32 w-full place-items-center overflow-hidden rounded-xl bg-slate-100">
                      {bestImageUrl ? (
                        <img
                          src={bestImageUrl}
                          alt={best.quarry_name}
                          className="h-32 w-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-slate-400" />
                      )}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 border-t border-sky-100 pt-3 text-center">
                      <div>
                        <span className="block text-[10px] text-slate-500">Материал</span>
                        <strong className="text-sm text-slate-900">{Math.round(aggregate.materialCost).toLocaleString("ru-RU")} ₽</strong>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">Доставка</span>
                        <strong className="text-sm text-slate-900">{Math.round(aggregate.deliveryCost).toLocaleString("ru-RU")} ₽</strong>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">Итого</span>
                        <strong className="text-base text-sky-600">{Math.round(aggregate.totalAmount).toLocaleString("ru-RU")} ₽</strong>
                      </div>
                    </div>
                  </div>

                  {groupAlternatives.length > 0 && (
                    <div className="mt-4">
                      <h4 className="mb-2 px-1 text-sm font-bold text-slate-800">Другие варианты</h4>
                      <div className="hide-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
                        {groupAlternatives.map(({ item, option }) => (
                          <article key={`${item.id}-${option.quarry_id}`} className="w-[230px] shrink-0 snap-start rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center gap-3">
                              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-200">
                                {resolveMediaUrl(option.primary_image_url) ? (
                                  <img
                                    src={resolveMediaUrl(option.primary_image_url) || undefined}
                                    alt={option.quarry_name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <ImageIcon className="h-5 w-5 text-slate-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <h5 className="line-clamp-2 text-sm font-bold text-slate-900">{option.quarry_name}</h5>
                                <p className="mt-1 text-xs text-slate-500">{Number(option.distance).toFixed(1)} км от адреса</p>
                                <p className="mt-1 truncate text-[10px] font-semibold text-sky-600">{item.deliveryOption.title}</p>
                              </div>
                            </div>
                            <div className="mt-3 flex items-end justify-between gap-3">
                              <div>
                                <span className="block text-[10px] uppercase text-slate-400">Итого</span>
                                <strong className="text-base text-slate-900">{Math.round(option.total_amount).toLocaleString("ru-RU")} ₽</strong>
                              </div>
                              <button
                                type="button"
                                onClick={() => selectMarketplaceOption(item.id, option)}
                                className="rounded-xl bg-[#2DB0E6] px-3 py-2 text-xs font-bold text-white hover:bg-[#209ccf]"
                              >
                                Выбрать
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setMapContext({
                        itemId: representativeItem.id,
                        material: representativeItem.material,
                        deliveryOptionId: representativeItem.deliveryOption.id,
                      })
                    }
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-sky-700 transition-colors hover:bg-sky-100"
                  >
                    <MapPin className="h-4 w-4" />
                    Посмотреть все точки на карте
                  </button>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Sticky Bottom Bar */}
      <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] left-0 right-0 max-w-md mx-auto bg-white border-t border-gray-100 px-4 pt-4 pb-8 flex justify-between items-center z-40 w-full min-h-[96px]">
        {isCalculating ? (
          <div className="flex items-center justify-center w-full gap-2 text-slate-500 font-medium">
            <Loader2 className="w-5 h-5 animate-spin text-[#2DB0E6]" />
            Секунду, рассчитываем доставку...
          </div>
        ) : (
          <>
            <div className="flex flex-col">
              <span className="text-xs text-slate-500 font-medium mb-0.5">
                Итого:
              </span>
              <span className="font-bold text-lg text-slate-900">
                {finalTotal.toLocaleString("ru-RU")} ₽
              </span>
            </div>
            <button
              disabled={
                isSubmitting ||
                !globalAddress.trim() ||
                hasCalculationError ||
                !hasCalculations ||
                totalDeliveryCost === 0
              }
              onClick={handleCheckout}
              className="bg-[#2DB0E6] text-white px-8 py-3.5 rounded-xl font-semibold shadow-sm active:bg-[#209dd0] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Оформляем...
                </>
              ) : (
                "Оформить заказ"
              )}
            </button>
          </>
        )}
      </div>

      {mapContext && (
        <PickupPointMapScreen
          material={mapContext.material}
          deliveryLocation={deliveryCoords}
          onClose={() => setMapContext(null)}
          onSelect={selectPointFromMap}
        />
      )}
    </div>
  );
}
