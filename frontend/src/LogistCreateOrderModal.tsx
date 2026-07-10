import React, { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import toast from "react-hot-toast";
import { fetch2gisAddressSuggestions, withTyumenBias } from "./addressSearch";
import { baseURL } from "./utils";

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  materials: any[];
  deliveryOptions: any[];
  onOrderCreated: () => void;
}

interface DeliveryCalculationResult {
  quarry_id: string;
  quarry_name: string;
  mileage_km: number;
  material_cost: number;
  delivery_cost: number;
  estimated_total_amount: number;
}

const calculateMaterialCost = (material: any, deliveryOption: any) =>
  Math.round(
    Number(material?.price ?? 0) * Number(deliveryOption?.capacity_m3 ?? 0),
  );

const formatFastApiDetail = (detail: any, fallback: string) => {
  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry: any) => {
        if (entry?.loc && Array.isArray(entry.loc) && entry?.msg) {
          return `${entry.loc.join(".")} - ${entry.msg}`;
        }
        if (typeof entry?.msg === "string") {
          return entry.msg;
        }
        if (typeof entry === "string") {
          return entry;
        }
        return null;
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join("\n");
    }
  }

  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (detail && typeof detail === "object" && typeof detail.msg === "string") {
    return detail.msg;
  }

  return fallback;
};

export default function LogistCreateOrderModal({
  isOpen,
  onClose,
  token,
  materials,
  deliveryOptions,
  onOrderCreated,
}: CreateOrderModalProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationResult, setCalculationResult] =
    useState<DeliveryCalculationResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [materialTotal, setMaterialTotal] = useState<number | string>("");
  const [deliveryTotal, setDeliveryTotal] = useState<number | string>("");
  const [newOrder, setNewOrder] = useState({
    client_name: "",
    client_phone: "",
    material_id: "",
    delivery_option_id: "",
    delivery_address: "",
    delivery_lat: null as number | null,
    delivery_lon: null as number | null,
    notes: "",
  });

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const deliveryInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setSuggestions([]);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setCalculationResult(null);
      setCalcError(null);
      setSuggestions([]);
      setIsCalculating(false);
      setIsCreating(false);
      setMaterialTotal("");
      setDeliveryTotal("");
      setNewOrder({
        client_name: "",
        client_phone: "",
        material_id: "",
        delivery_option_id: "",
        delivery_address: "",
        delivery_lat: null,
        delivery_lon: null,
        notes: "",
      });
    }
  }, [isOpen]);

  const selectedMaterial =
    materials.find((item) => item.id === newOrder.material_id) || null;
  const selectedDeliveryOption =
    deliveryOptions.find((item) => item.id === newOrder.delivery_option_id) ||
    null;
  const computedMaterialCost = calculateMaterialCost(
    selectedMaterial,
    selectedDeliveryOption,
  );

  useEffect(() => {
    const shouldCalculate =
      !!newOrder.material_id &&
      !!newOrder.delivery_option_id &&
      newOrder.delivery_lat != null &&
      newOrder.delivery_lon != null;

    if (!shouldCalculate) {
      setCalculationResult(null);
      setCalcError(null);
      setIsCalculating(false);
      setMaterialTotal("");
      setDeliveryTotal("");
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setIsCalculating(true);
        setCalcError(null);
        const response = await fetch(`${baseURL}/client/orders/calculate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            material_id: newOrder.material_id,
            delivery_option_id: newOrder.delivery_option_id,
            delivery_lat: newOrder.delivery_lat,
            delivery_lon: newOrder.delivery_lon,
            quantity: 1,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("404_NO_QUARRY");
          } else if (response.status === 409) {
            throw new Error("409_NO_RATE");
          }
          throw new Error(
            formatFastApiDetail(data?.detail, "Не удалось рассчитать доставку"),
          );
        }

        if (!cancelled) {
          const materialCost =
            computedMaterialCost ||
            Number(data.material_cost ?? data.total_amount ?? 0);
          const deliveryCost = Number(data.delivery_cost ?? 0);
          setCalculationResult({
            quarry_id: data.quarry_id,
            quarry_name: data.quarry_name,
            mileage_km: Number(data.mileage_km ?? data.distance ?? 0),
            material_cost: materialCost,
            delivery_cost: deliveryCost,
            estimated_total_amount: materialCost + deliveryCost,
          });
          setMaterialTotal(materialCost);
          setDeliveryTotal(deliveryCost);
        }
      } catch (error: any) {
        if (!cancelled) {
          setCalculationResult(null);
          setMaterialTotal("");
          setDeliveryTotal("");
          if (error.message === "404_NO_QUARRY") {
            setCalcError("❌ Нет доступного карьера с выбранным материалом.");
          } else if (error.message === "409_NO_RATE") {
            setCalcError("❌ У выбранного типа машины не настроена ставка за км. Настройте тарифы в справочнике.");
          } else {
            setCalcError("❌ " + (error?.message || "Ошибка при расчете стоимости."));
          }
        }
      } finally {
        if (!cancelled) {
          setIsCalculating(false);
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    newOrder.material_id,
    newOrder.delivery_option_id,
    newOrder.delivery_lat,
    newOrder.delivery_lon,
    token,
    computedMaterialCost,
    materials,
    deliveryOptions,
  ]);

  const formatPhoneNumber = (value: string) => {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("7") || digits.startsWith("8")) {
      digits = digits.substring(1);
    }
    digits = digits.substring(0, 10);

    let formatted = "+7";
    if (digits.length > 0) formatted += " (" + digits.substring(0, 3);
    if (digits.length >= 3) formatted += ") " + digits.substring(3, 6);
    if (digits.length >= 6) formatted += "-" + digits.substring(6, 8);
    if (digits.length >= 8) formatted += "-" + digits.substring(8, 10);
    return formatted;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewOrder((prev) => ({
      ...prev,
      client_phone: formatPhoneNumber(e.target.value),
    }));
  };

  const fetch2GISSuggests = async (query: string) => {
    const items = await fetch2gisAddressSuggestions(query);
    return items.map((item: any) => item.search_attributes?.suggested_text);
  };

  const handleDeliveryChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;
    setNewOrder((prev) => ({
      ...prev,
      delivery_address: value,
      delivery_lat: null,
      delivery_lon: null,
    }));
    setCalculationResult(null);

    const suggests = await fetch2GISSuggests(value);
    setSuggestions(suggests.filter(Boolean));
  };

  const selectDeliverySuggestion = async (address: string) => {
    setNewOrder((prev) => ({
      ...prev,
      delivery_address: address,
      delivery_lat: null,
      delivery_lon: null,
    }));
    setSuggestions([]);
    setCalculationResult(null);

    try {
      const response = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(withTyumenBias(address))}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          formatFastApiDetail(data?.detail, "Не удалось определить координаты"),
        );
      }

      setNewOrder((prev) => ({
        ...prev,
        delivery_address: address,
        delivery_lat: data.lat,
        delivery_lon: data.lon,
      }));
    } catch (error: any) {
      toast.error(error?.message || "Не удалось определить координаты");
    }
  };

  const fixSuggestPosition = () => {
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const digitsOnly = newOrder.client_phone.replace(/\D/g, "");
    if (
      digitsOnly.length < 11 ||
      !newOrder.material_id ||
      !newOrder.delivery_option_id ||
      !newOrder.delivery_address ||
      newOrder.delivery_lat == null ||
      newOrder.delivery_lon == null ||
      !calculationResult
    ) {
      toast.error("Заполните обязательные поля и дождитесь расчета доставки");
      return;
    }

    const cleanPhone = "+" + digitsOnly;
    const normalizedClientName = newOrder.client_name.trim() || cleanPhone;
    const parsedMaterialTotal = Number(materialTotal);
    const parsedDeliveryTotal = Number(deliveryTotal);

    if (!Number.isFinite(parsedMaterialTotal) || parsedMaterialTotal <= 0) {
      toast.error("Укажите корректную стоимость материала");
      return;
    }

    if (!Number.isFinite(parsedDeliveryTotal) || parsedDeliveryTotal < 0) {
      toast.error("Укажите корректную стоимость доставки");
      return;
    }

    try {
      setIsCreating(true);

      const payload = {
        client_name: normalizedClientName,
        client_phone: cleanPhone,
        material_id: newOrder.material_id,
        delivery_option_id: newOrder.delivery_option_id,
        quarry_id: calculationResult.quarry_id,
        delivery_address: newOrder.delivery_address,
        delivery_lat: newOrder.delivery_lat,
        delivery_lon: newOrder.delivery_lon,
        mileage_km: calculationResult.mileage_km,
        estimated_total_amount: parsedMaterialTotal + parsedDeliveryTotal,
        total_amount: parsedMaterialTotal,
        delivery_cost: parsedDeliveryTotal,
        calculation_source: "yandex_auto",
        notes: newOrder.notes,
        quantity: 1,
        source: "dispatcher",
        auto_dispatch: true,
      };

      const res = await fetch(`${baseURL}/logist/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          formatFastApiDetail(
            responseData?.detail,
            "Ошибка при создании заказа",
          ),
        );
      }

      toast.success("Заказ создан");
      onOrderCreated();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Ошибка при создании заказа");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const isFormIncomplete =
    !newOrder.material_id ||
    !newOrder.delivery_option_id ||
    !newOrder.delivery_address ||
    newOrder.delivery_lat == null ||
    newOrder.delivery_lon == null ||
    !calculationResult;

  const formattedDistance = calculationResult
    ? `${Number(calculationResult.mileage_km).toLocaleString("ru-RU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })} км`
    : null;
  const materialPriceLabel = selectedMaterial
    ? `${Number(selectedMaterial.price ?? 0).toLocaleString("ru-RU")} ₽`
    : null;
  const capacityLabel = selectedDeliveryOption
    ? `${Number(selectedDeliveryOption.capacity_m3 ?? 0).toLocaleString("ru-RU")} м3`
    : null;

  const parsedMaterialTotal = Number(materialTotal);
  const parsedDeliveryTotal = Number(deliveryTotal);
  const computedEstimatedTotal =
    (Number.isFinite(parsedMaterialTotal) ? parsedMaterialTotal : 0) +
    (Number.isFinite(parsedDeliveryTotal) ? parsedDeliveryTotal : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-3xl">
          <h3 className="text-xl font-bold text-slate-800">Новый заказ</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={handleCreateOrder}
          className="p-6 overflow-y-auto flex flex-col gap-4"
        >
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Телефон клиента <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              required
              placeholder="+7 (999) 000-00-00"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm"
              value={newOrder.client_phone}
              onChange={handlePhoneChange}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Имя клиента
            </label>
            <input
              type="text"
              placeholder="Имя клиента"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm"
              value={newOrder.client_name}
              onChange={(e) =>
                setNewOrder((prev) => ({ ...prev, client_name: e.target.value }))
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Материал <span className="text-red-500">*</span>
              </label>
              <select
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm bg-white"
                value={newOrder.material_id}
                onChange={(e) =>
                  setNewOrder((prev) => ({ ...prev, material_id: e.target.value }))
                }
              >
                <option value="" disabled>
                  Выберите...
                </option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Машина <span className="text-red-500">*</span>
              </label>
              <select
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm bg-white"
                value={newOrder.delivery_option_id}
                onChange={(e) =>
                  setNewOrder((prev) => ({
                    ...prev,
                    delivery_option_id: e.target.value,
                  }))
                }
              >
                <option value="" disabled>
                  Выберите...
                </option>
                {[...deliveryOptions]
                  .sort((a, b) => (a.capacity_m3 || 0) - (b.capacity_m3 || 0))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title} ({o.capacity_m3} м³)
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="relative" ref={wrapperRef}>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Куда везем (Точка Б) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <MapPin className="absolute left-3.5 top-[14px] w-5 h-5 text-slate-400" />
              <input
                type="text"
                id="delivery-input"
                ref={deliveryInputRef}
                required
                autoComplete="off"
                onFocus={fixSuggestPosition}
                placeholder="Улица, дом, город"
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm"
                value={newOrder.delivery_address}
                onChange={handleDeliveryChange}
              />
            </div>
            {suggestions.length > 0 && (
              <ul className="absolute z-[9999] top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                {suggestions.map((addr, idx) => (
                  <li
                    key={idx}
                    onClick={() => selectDeliverySuggestion(addr)}
                    className="p-3 text-sm text-gray-800 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-0"
                  >
                    {addr}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Комментарий
            </label>
            <textarea
              placeholder="Уточнения по доставке..."
              rows={2}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm resize-none"
              value={newOrder.notes}
              onChange={(e) =>
                setNewOrder((prev) => ({ ...prev, notes: e.target.value }))
              }
            />
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col gap-3 text-sm text-slate-800">
            <h4 className="font-bold text-slate-900">Результат расчета</h4>
            {calcError && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm font-medium">
                {calcError}
              </div>
            )}
            
            {isCalculating ? (
              <div className="flex items-center gap-3 text-slate-500 py-2">
                <Loader2 className="w-5 h-5 animate-spin text-[#2DB0E6]" />
                <span>Рассчитываем ближайший карьер и стоимость доставки...</span>
              </div>
            ) : calculationResult ? (
              <>
                <div className="rounded-xl bg-white px-4 py-3 border border-slate-200 flex flex-col gap-3">
                  <div>
                    <label className="text-sm font-bold text-slate-900" htmlFor="material-total">
                      {"\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u0430 (\u0440\u0443\u0431)"}
                    </label>
                    <input
                      id="material-total"
                      type="number"
                      min="0"
                      step="0.01"
                      value={materialTotal}
                      onChange={(e) => setMaterialTotal(e.target.value)}
                      className="mt-2 w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm font-semibold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-slate-900" htmlFor="delivery-total">
                      {"\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438 (\u0440\u0443\u0431)"}
                    </label>
                    <input
                      id="delivery-total"
                      type="number"
                      min="0"
                      step="0.01"
                      value={deliveryTotal}
                      onChange={(e) => setDeliveryTotal(e.target.value)}
                      className="mt-2 w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm font-semibold text-slate-900"
                    />
                  </div>
                  <div className="flex justify-between items-center rounded-xl bg-slate-50 px-4 py-3 border border-slate-200">
                    <span className="text-sm font-bold text-slate-900">{"\u0418\u0442\u043e\u0433\u043e \u043a \u043e\u043f\u043b\u0430\u0442\u0435"}</span>
                    <span className="text-base font-black text-slate-900">
                      {computedEstimatedTotal.toLocaleString("ru-RU")} {"\u20BD"}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Ближайший карьер:</span>
                  <span className="font-medium text-right text-slate-900">
                    {calculationResult.quarry_name}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Дистанция:</span>
                  <span className="font-medium text-slate-900">
                    {formattedDistance}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-slate-500 leading-relaxed">
                Выберите материал, машину и адрес доставки из подсказок 2ГИС. После этого система автоматически найдет ближайший карьер и посчитает стоимость.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isCreating || isCalculating || isFormIncomplete || !!calcError}
              className="px-5 py-2.5 rounded-xl font-bold bg-[#2DB0E6] text-white hover:bg-[#259ac9] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
            >
              {isCreating ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "Сохранить"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
