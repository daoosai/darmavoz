import React, { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import toast from "react-hot-toast";
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
  delivery_cost: number;
  total_amount: number;
}

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
      setSuggestions([]);
      setIsCalculating(false);
      setIsCreating(false);
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

  useEffect(() => {
    const shouldCalculate =
      !!newOrder.material_id &&
      !!newOrder.delivery_option_id &&
      newOrder.delivery_lat != null &&
      newOrder.delivery_lon != null;

    if (!shouldCalculate) {
      setCalculationResult(null);
      setIsCalculating(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setIsCalculating(true);
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
          throw new Error(data?.detail || "Не удалось рассчитать доставку");
        }

        if (!cancelled) {
          setCalculationResult(data as DeliveryCalculationResult);
        }
      } catch (error: any) {
        if (!cancelled) {
          setCalculationResult(null);
          toast.error(error?.message || "Не удалось рассчитать доставку");
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
    if (query.length < 3) return [];
    try {
      const res = await fetch(
        `https://catalog.api.2gis.com/3.0/suggests?q=${encodeURIComponent(
          query,
        )}&suggest_type=address&key=1ee6f536-8494-4bb2-adc0-d011444c567a`,
      );
      const data = await res.json();
      return (
        data.result?.items?.map(
          (item: any) => item.search_attributes?.suggested_text,
        ) || []
      );
    } catch {
      return [];
    }
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
        `${baseURL}/geo/geocode?address=${encodeURIComponent(address)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.detail || "Не удалось определить координаты");
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

    try {
      setIsCreating(true);

      const payload = {
        client_name: newOrder.client_name,
        client_phone: cleanPhone,
        material_id: newOrder.material_id,
        delivery_option_id: newOrder.delivery_option_id,
        quarry_id: calculationResult.quarry_id,
        delivery_address: newOrder.delivery_address,
        delivery_lat: newOrder.delivery_lat,
        delivery_lon: newOrder.delivery_lon,
        mileage_km: calculationResult.mileage_km,
        estimated_total_amount: calculationResult.total_amount,
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
        throw new Error(responseData.detail || "Ошибка при создании заказа");
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
            {isCalculating ? (
              <div className="flex items-center gap-3 text-slate-500 py-2">
                <Loader2 className="w-5 h-5 animate-spin text-[#2DB0E6]" />
                <span>Рассчитываем ближайший карьер и стоимость доставки...</span>
              </div>
            ) : calculationResult ? (
              <>
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
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Стоимость доставки:</span>
                  <span className="font-medium text-slate-900">
                    {Number(calculationResult.delivery_cost).toLocaleString("ru-RU")} ₽
                  </span>
                </div>
                <div className="pt-3 border-t border-slate-200 flex justify-between gap-4 text-base">
                  <span className="font-bold text-slate-900">Итого к оплате:</span>
                  <span className="font-bold text-slate-900">
                    {Number(calculationResult.total_amount).toLocaleString("ru-RU")} ₽
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
              disabled={isCreating || isCalculating || isFormIncomplete}
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