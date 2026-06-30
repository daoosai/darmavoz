import React, { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
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

const formatUnit = (unitText: string | undefined) => {
  if (!unitText) return "м³";
  const lower = unitText.toLowerCase();
  if (lower.includes("тонн") || lower === "т" || lower === "t") return "т";
  if (lower.includes("куб") || lower.includes("м3") || lower.includes("м³"))
    return "м³";
  return unitText.toLowerCase();
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
  const [newOrder, setNewOrder] = useState({
    client_name: "",
    client_phone: "",
    material_id: "",
    delivery_option_id: "",
    pickup_address: "",
    delivery_address: "",
    mileage_km: 0,
    notes: "",
  });

  const [suggestionsA, setSuggestionsA] = useState<string[]>([]);
  const [suggestionsB, setSuggestionsB] = useState<string[]>([]);

  const pickupInputRef = useRef<HTMLInputElement>(null);
  const deliveryInputRef = useRef<HTMLInputElement>(null);

  const wrapperARef = useRef<HTMLDivElement>(null);
  const wrapperBRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        wrapperARef.current &&
        !wrapperARef.current.contains(event.target as Node)
      ) {
        setSuggestionsA([]);
      }
      if (
        wrapperBRef.current &&
        !wrapperBRef.current.contains(event.target as Node)
      ) {
        setSuggestionsB([]);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

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
    setNewOrder({
      ...newOrder,
      client_phone: formatPhoneNumber(e.target.value),
    });
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const digitsOnly = newOrder.client_phone.replace(/\D/g, "");
    if (
      digitsOnly.length < 11 ||
      !newOrder.material_id ||
      !newOrder.delivery_option_id ||
      !newOrder.delivery_address ||
      !newOrder.pickup_address ||
      !newOrder.mileage_km
    ) {
      toast.error("Пожалуйста, заполните все обязательные поля корректно");
      return;
    }

    const selectedDeliveryOption = deliveryOptions.find(
      (o) => o.id === newOrder.delivery_option_id,
    );
    if (!selectedDeliveryOption?.delivery_rate_per_km) {
      toast.error("У данного типа машины не настроена ставка за км!");
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
        pickup_address: newOrder.pickup_address,
        pickup_lat: null,
        pickup_lon: null,
        delivery_address: newOrder.delivery_address,
        delivery_lat: null,
        delivery_lon: null,
        mileage_km: newOrder.mileage_km,
        calculation_source: "manual",
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

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Ошибка при создании заказа");
      }

      const createdOrder = await res.json().catch(() => ({}));

      toast.success("Заказ создан");
      onOrderCreated();
      onClose();

      if (createdOrder && createdOrder.id) {
        try {
          await fetch(`${baseURL}/logist/orders/${createdOrder.id}/dispatch`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          toast.success("Запущена диспетчеризация");
        } catch (e) {
          toast.error("Диспетчеризация не запущена автоматически");
        }
      }
    } catch (err: any) {
      toast.error(
        err.response?.data?.detail ||
          err.message ||
          "Ошибка при создании заказа",
      );
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const selectedMaterial = materials.find((m) => m.id === newOrder.material_id);
  const selectedOption = deliveryOptions.find(
    (o) => o.id === newOrder.delivery_option_id,
  );

  const materialPrice = Number(selectedMaterial?.price) || 0;
  const volume = Number(selectedOption?.capacity_m3) || 0;
  const materialTotal = materialPrice * volume;

  const deliveryRate = Number(selectedOption?.delivery_rate_per_km) || 0;
  const distance = Number(newOrder.mileage_km) || 0;
  const deliveryTotal = distance * deliveryRate;

  const grandTotal = materialTotal + deliveryTotal;

  const isRateMissing = selectedOption && !deliveryRate;
  const isFormIncomplete =
    !newOrder.material_id ||
    !newOrder.delivery_option_id ||
    !newOrder.mileage_km ||
    !newOrder.pickup_address ||
    !newOrder.delivery_address;

  const handleScroll = () => {
    if (document.activeElement && document.activeElement.tagName === "INPUT") {
      (document.activeElement as HTMLElement).blur();
    }
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
    } catch (e) {
      return [];
    }
  };

  const handlePickupChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewOrder((prev) => ({ ...prev, pickup_address: val }));

    const suggests = await fetch2GISSuggests(val);
    setSuggestionsA(suggests);
  };

  const selectPickupSuggestion = (address: string) => {
    setNewOrder((prev) => ({ ...prev, pickup_address: address }));
    setSuggestionsA([]);
  };

  const handleDeliveryChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const val = e.target.value;
    setNewOrder((prev) => ({ ...prev, delivery_address: val }));

    const suggests = await fetch2GISSuggests(val);
    setSuggestionsB(suggests);
  };

  const selectDeliverySuggestion = (address: string) => {
    setNewOrder((prev) => ({ ...prev, delivery_address: address }));
    setSuggestionsB([]);
  };

  const fixSuggestPosition = () => {
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
  };

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
          onScroll={handleScroll}
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
              placeholder="Иван"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm"
              value={newOrder.client_name}
              onChange={(e) =>
                setNewOrder({ ...newOrder, client_name: e.target.value })
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
                  setNewOrder({ ...newOrder, material_id: e.target.value })
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
                  setNewOrder({
                    ...newOrder,
                    delivery_option_id: e.target.value,
                  })
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

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Дистанция (км) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              required
              min="0.1"
              step="0.1"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm"
              value={newOrder.mileage_km || ""}
              onChange={(e) =>
                setNewOrder({
                  ...newOrder,
                  mileage_km: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>

          <div className="relative" ref={wrapperARef}>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Откуда везем (Точка А) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="pickup-input"
              ref={pickupInputRef}
              required
              autoComplete="off"
              onFocus={fixSuggestPosition}
              placeholder="ул. Погрузки, д. 1"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm"
              value={newOrder.pickup_address}
              onChange={handlePickupChange}
            />
            {suggestionsA.length > 0 && (
              <ul className="absolute z-[9999] top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                {suggestionsA.map((addr, idx) => (
                  <li
                    key={idx}
                    onClick={() => selectPickupSuggestion(addr)}
                    className="p-3 text-sm text-gray-800 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-0"
                  >
                    {addr}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="relative" ref={wrapperBRef}>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Куда везем (Точка Б) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="delivery-input"
              ref={deliveryInputRef}
              required
              autoComplete="off"
              onFocus={fixSuggestPosition}
              placeholder="ул. Доставки, д. 2"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm"
              value={newOrder.delivery_address}
              onChange={handleDeliveryChange}
            />
            {suggestionsB.length > 0 && (
              <ul className="absolute z-[9999] top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                {suggestionsB.map((addr, idx) => (
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
                setNewOrder({ ...newOrder, notes: e.target.value })
              }
            />
          </div>

          {/* Сводка по заказу */}
          <div className="p-4 rounded-lg bg-gray-50 flex flex-col gap-2 text-sm text-slate-800">
            <h4 className="font-bold mb-1">Сводка по заказу</h4>
            {isRateMissing ? (
              <p className="text-red-600 font-medium">
                У данного типа машины не настроена ставка за км!
              </p>
            ) : (
              <>
                <div className="flex justify-between items-center mb-1">
                  <span>Стоимость материала:</span>
                  <span className="font-medium">
                    {materialTotal.toLocaleString("ru-RU")} ₽
                  </span>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span>Стоимость доставки:</span>
                  <span className="font-medium">
                    {deliveryTotal.toLocaleString("ru-RU")} ₽
                  </span>
                </div>
                <div className="border-t border-gray-200 my-2"></div>
                <div className="flex justify-between items-center text-lg font-bold text-slate-900">
                  <span>Итого к оплате:</span>
                  <span>{grandTotal.toLocaleString("ru-RU")} ₽</span>
                </div>
              </>
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
              disabled={isCreating || isRateMissing || isFormIncomplete}
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
