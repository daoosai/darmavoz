import React, { useState, useEffect } from "react";
import {
  ShoppingCart,
  X,
  ImageIcon,
  Loader2,
  MapPin,
  Minus,
  Plus,
} from "lucide-react";
import { useAuthStore, useCartStore, useAddressStore } from "./store";
import { getImageUrl, baseURL } from "./utils";
import toast from "react-hot-toast";

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
    increaseQuantity,
    decreaseQuantity,
  } = useCartStore();
  const { role, token } = useAuthStore();
  const { selectedAddress, setSelectedAddress } = useAddressStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalAddress, setGlobalAddress] = useState(selectedAddress);
  const [calcResults, setCalcResults] = useState<Record<string, any>>({});
  const [isCalculating, setIsCalculating] = useState(false);

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

        // Fetch calculation for each item
        const newResults: Record<string, any> = {};
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
        console.error("Calculation error", e);
        // If geocode fails or network fails, we can also set error state
        const errResults: Record<string, any> = {};
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
  }, [globalAddress, cartItems, token, role]);

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGlobalAddress(e.target.value);
    setSelectedAddress(e.target.value);
  };

  const handleCheckout = async () => {
    if (cartItems.length === 0 || !globalAddress.trim()) return;

    if (role !== "client") {
      onOpenAuth();
      return;
    }

    try {
      setIsSubmitting(true);

      const requests = cartItems.map((item) =>
        fetch(`${baseURL}/orders/checkout`, {
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
            quarry_id: calcResults[item.id]?.quarry_id,
            mileage_km: calcResults[item.id]?.mileage_km,
            total_amount: calcResults[item.id]?.total_amount
              ? calcResults[item.id].total_amount * item.quantity
              : undefined,
          }),
        }),
      );

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
  const hasCalculationError = cartItems.some(
    (item) => calcResults[item.id]?.error,
  );
  const showWarning =
    hasCalculationError || (cartItems.length > 0 && !globalAddress.trim());

  const totalDeliveryCost = cartItems.reduce((acc, item) => {
    const res = calcResults[item.id];
    const safeDeliveryPrice = Number(res?.delivery_cost) || 0;
    return acc + safeDeliveryPrice * item.quantity;
  }, 0);

  const finalTotal = Math.round(
    hasCalculations && !isCalculating && !hasCalculationError
      ? cartItems.reduce((acc, item) => {
          const res = calcResults[item.id];
          if (!res || res.error) return acc;
          const safeMaterialPrice = Number(res.total_amount) || 0;
          const safeDeliveryPrice = Number(res.delivery_cost) || 0;
          const safeEstimated =
            Number(res.estimated_total_amount) ||
            safeMaterialPrice + safeDeliveryPrice;
          return acc + safeEstimated * item.quantity;
        }, 0)
      : totalMaterialCost,
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
          {cartItems.map((item) => (
            <div
              key={item.id}
              className="bg-white p-3 rounded-[24px] flex flex-row items-start shadow-sm border border-slate-100"
            >
              <div className="w-[80px] h-[80px] bg-slate-100 rounded-[16px] overflow-hidden shrink-0 flex items-center justify-center">
                {getImageUrl(item.material) !== "/placeholder.jpg" ? (
                  <img
                    src={getImageUrl(item.material)}
                    alt={item.material?.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-slate-300" />
                )}
              </div>
              <div className="flex flex-col justify-between flex-1 ml-3 h-[80px]">
                <div className="flex justify-between items-start">
                  <h3 className="font-bold text-[16px] text-slate-900 leading-tight line-clamp-1">
                    {item.material?.name}
                  </h3>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="p-1 -mt-1 -mr-1 text-slate-400 hover:text-red-500 hover:bg-slate-50 transition-colors rounded-full"
                  >
                    <X className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>

                <div className="text-[14px] text-slate-500 line-clamp-1">
                  {item.deliveryOption.title} ({item.deliveryOption.capacity_m3}{" "}
                  м³)
                </div>

                {item.comment && (
                  <div className="text-[13px] italic text-slate-400 line-clamp-1 mt-0.5">
                    {item.comment}
                  </div>
                )}

                <div className="flex justify-end items-end mt-auto">
                  <div className="flex items-center gap-2.5 bg-slate-50 rounded-full px-2 py-0.5 border border-slate-100 mb-1">
                    <button
                      onClick={() => decreaseQuantity(item.id)}
                      disabled={item.quantity <= 1}
                      className="p-0.5 text-slate-400 hover:text-[#2DB0E6] disabled:opacity-50 disabled:hover:text-slate-400 transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-semibold text-slate-700 w-4 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => increaseQuantity(item.id)}
                      disabled={item.quantity >= 10}
                      className="p-0.5 text-slate-400 hover:text-[#2DB0E6] disabled:opacity-50 disabled:hover:text-slate-400 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
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

        {/* Calculation Result / Receipt */}
        {showWarning ? (
          <div className="bg-orange-50 rounded-[24px] p-4 border border-orange-100 flex items-start gap-3 mt-2">
            <div className="text-orange-600 font-medium text-[14px] leading-snug">
              Доставка этого материала в ваш район временно невозможна (нет
              активных карьеров).
            </div>
          </div>
        ) : (
          (hasCalculations || isCalculating) && (
            <div className="bg-white rounded-[24px] p-5 shadow-sm border border-slate-100 flex flex-col gap-4 mt-2">
              <h3 className="font-semibold text-slate-800 text-[16px]">
                Заказ
              </h3>

              {isCalculating ? (
                <div className="flex justify-center items-center py-6 flex-col gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-[#2DB0E6]" />
                  <span className="text-sm text-slate-500 font-medium">
                    Вычисляем стоимость...
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {cartItems.map((item) => {
                    const res = calcResults[item.id];
                    if (!res || res.error) return null;

                    const distanceKm = res.distance_km || res.mileage_km;
                    const safeMaterialPrice = Number(res.total_amount) || 0;
                    const safeDeliveryPrice = Number(res.delivery_cost) || 0;
                    const safeEstimated =
                      Number(res.estimated_total_amount) ||
                      safeMaterialPrice + safeDeliveryPrice;

                    const deliveryCost = Math.round(
                      safeDeliveryPrice * item.quantity,
                    );
                    const totalAmount = Math.round(
                      safeMaterialPrice * item.quantity,
                    );
                    const estimatedTotalAmount = Math.round(
                      safeEstimated * item.quantity,
                    );
                    const loadingPoint = res.loading_point || res.quarry_name;
                    const volume =
                      item.deliveryOption.capacity_m3 * item.quantity;

                    return (
                      <div
                        key={item.id}
                        className="flex flex-col gap-2 pb-5 border-b border-slate-100 last:border-0 last:pb-0"
                      >
                        <div className="flex justify-between items-start text-slate-900 mb-1">
                          <span className="font-bold text-[16px] leading-tight pr-2">
                            {item.material.name}
                          </span>
                          <span className="font-bold text-[16px] whitespace-nowrap">
                            {totalAmount.toLocaleString("ru-RU")} ₽
                          </span>
                        </div>

                        <div className="flex flex-col gap-2 text-[14px] text-slate-600 bg-slate-50/50 p-3 rounded-xl border border-slate-50">
                          <div className="flex justify-between items-start">
                            <span>Объем машины:</span>
                            <span className="font-medium text-slate-800">
                              {volume} м³
                            </span>
                          </div>
                          <div className="flex justify-between items-start">
                            <span>Ближайший карьер:</span>
                            <span className="font-medium text-slate-800 text-right max-w-[65%] leading-tight">
                              {loadingPoint}
                            </span>
                          </div>
                          <div className="flex justify-between items-start">
                            <span>
                              Доставка:{" "}
                              <span className="text-slate-500 text-[13px]">
                                ({distanceKm} км)
                              </span>
                            </span>
                            <span className="font-medium text-slate-800">
                              {deliveryCost.toLocaleString("ru-RU")} ₽
                            </span>
                          </div>
                        </div>

                        <div className="flex justify-between text-[16px] font-bold text-slate-900 mt-1 pl-1 pr-1">
                          <span>Итого к оплате:</span>
                          <span className="text-[#2DB0E6] text-[18px]">
                            {estimatedTotalAmount.toLocaleString("ru-RU")} ₽
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}
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
    </div>
  );
}
