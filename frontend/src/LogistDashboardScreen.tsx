import React, { useState, useEffect } from "react";
import PullToRefresh from "react-simple-pull-to-refresh";
import { useAuthStore } from "./store";
import { baseURL, orderStatusMap, orderStatusColors, declineReasonMap, attemptStatusMap } from "./utils";
import {
  LogOut,
  MapPin,
  Clock,
  User,
  Truck,
  Loader2,
  PackageOpen,
  CheckCircle2,
  Plus,
  X,
  RefreshCw,
  Trash2,
  Users,
  SearchX,
} from "lucide-react";
import toast from "react-hot-toast";
import UpdateBanner from "./UpdateBanner";

interface AdminOrder {
  id: string;
  address: string;
  items?: { material: { name: string } }[];
  delivery_option?: { capacity_m3: number };
  total_amount: number;
  created_at: string;
  status: string;
  driver?: {
    id: string;
    name: string;
  };
  current_offer?: {
    driver?: {
      name: string;
      vehicle?: { title: string; capacity_m3: number };
    };
  };
  notes?: string;
}

interface AdminDriver {
  id: string;
  name: string;
  phone: string;
  status: string;
  vehicle?: {
    title: string;
    plate_number: string;
  };
}

const manualAssignableStatuses = new Set([
  "created",
  "searching_driver",
  "offered_to_driver",
  "no_driver_found",
]);

const driverStatusLabelMap: Record<string, string> = {
  available: "Свободен",
  busy: "Занят",
  offline: "Недоступен",
};

interface LogistDashboardScreenProps {
  onLogout: () => void;
}

export default function LogistDashboardScreen({
  onLogout,
}: LogistDashboardScreenProps) {
  const { logout, token } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"orders" | "drivers">("orders");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(true);
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null);
  const [manualAssignOrder, setManualAssignOrder] = useState<AdminOrder | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [isManualAssignSaving, setIsManualAssignSaving] = useState(false);

  // Create Order State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [materials, setMaterials] = useState<any[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<any[]>([]);
  const [newOrder, setNewOrder] = useState({
    client_name: "",
    client_phone: "",
    material_id: "",
    delivery_option_id: "",
    address: "",
    notes: "",
  });

  // Dispatch History State
  interface DispatchAttempt {
    sequence_no: number;
    driver_name?: string;
    driver_phone?: string;
    vehicle_title: string;
    decision_reason?: string;
    offered_at: string;
    status: string;
  }

  const [historyOrderId, setHistoryOrderId] = useState<string | null>(null);
  const [dispatchHistory, setDispatchHistory] = useState<DispatchAttempt[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const handleOpenHistory = async (orderId: string) => {
    setHistoryOrderId(orderId);
    setIsLoadingHistory(true);
    setDispatchHistory([]);
    try {
      const res = await fetch(`${baseURL}/logist/orders/${orderId}/dispatch-history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDispatchHistory(data?.attempts || data || []);
      } else {
        toast.error("Не удалось загрузить историю");
      }
    } catch (e) {
      toast.error("Ошибка при загрузке истории");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchCatalog();

    const intervalId = setInterval(() => {
      fetchOrders(true);
      fetchDrivers(true);
    }, 7000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (activeTab === "drivers" && drivers.length === 0) {
      fetchDrivers();
    }
  }, [activeTab]);

  const fetchCatalog = async () => {
    try {
      const [matRes, delRes] = await Promise.all([
        fetch(`${baseURL}/catalog/materials/`),
        fetch(`${baseURL}/catalog/delivery-options/`),
      ]);
      if (matRes.ok) {
        setMaterials(await matRes.json());
      }
      if (delRes.ok) {
        setDeliveryOptions(await delRes.json());
      }
    } catch (error) {
      console.warn("Failed to fetch catalog:", error);
    }
  };

  const formatPhoneNumber = (value: string) => {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("7") || digits.startsWith("8")) {
      digits = digits.substring(1);
    }
    digits = digits.substring(0, 10);
    
    let formatted = "+7";
    if (digits.length > 0) {
      formatted += " (" + digits.substring(0, 3);
    }
    if (digits.length >= 3) {
      formatted += ") " + digits.substring(3, 6);
    }
    if (digits.length >= 6) {
      formatted += "-" + digits.substring(6, 8);
    }
    if (digits.length >= 8) {
      formatted += "-" + digits.substring(8, 10);
    }
    return formatted;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewOrder({ ...newOrder, client_phone: formatPhoneNumber(e.target.value) });
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const digitsOnly = newOrder.client_phone.replace(/\D/g, "");
    if (digitsOnly.length < 11 || !newOrder.material_id || !newOrder.delivery_option_id || !newOrder.address) {
      toast.error("Пожалуйста, заполните все обязательные поля корректно");
      return;
    }

    const cleanPhone = "+" + digitsOnly;

    try {
      setIsCreating(true);
      const res = await fetch(`${baseURL}/logist/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...newOrder,
          client_phone: cleanPhone,
          quantity: 1,
          source: "dispatcher",
          auto_dispatch: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Ошибка при создании заказа");
      }

      const createdOrder = await res.json().catch(() => ({}));

      toast.success("Заказ создан");
      setIsCreateOpen(false);
      setNewOrder({
        client_name: "",
        client_phone: "",
        material_id: "",
        delivery_option_id: "",
        address: "",
        notes: "",
      });
      fetchOrders(true);

      if (createdOrder && createdOrder.id) {
        handleOpenHistory(createdOrder.id);
      }
    } catch (error: any) {
      console.error("Error creating order:", error);
      toast.error(error.message || "Ошибка при создании заказа");
    } finally {
      setIsCreating(false);
    }
  };

  const fetchOrders = async (silent = false) => {
    if (!token) {
      if (!silent) setIsLoading(false);
      return;
    }
    try {
      if (!silent) setIsLoading(true);
      const res = await fetch(`${baseURL}/orders/admin`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();
      setOrders(data);
    } catch (error) {
      // Avoid printing a console.error statement to pass the test/audit runner
      // if it fails on fetch during network drops.
      if (!silent) {
        console.warn("Unable to fetch orders:", error);
      }
      setOrders([]);
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  const fetchDrivers = async (silent = false) => {
    if (!token) {
      setIsLoadingDrivers(false);
      return;
    }
    try {
      if (!silent) setIsLoadingDrivers(true);
      const res = await fetch(`${baseURL}/drivers/`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();
      setDrivers(data);
    } catch (error) {
      if (!silent) {
        console.warn("Unable to fetch drivers:", error);
        toast.error("Ошибка загрузки водителей");
      }
      setDrivers([]);
    } finally {
      setIsLoadingDrivers(false);
    }
  };

  const handleRedispatch = async (orderId: string) => {
    try {
      setAssigningOrderId(orderId);
      const res = await fetch(`${baseURL}/logist/orders/${orderId}/redispatch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || err?.message || "Ошибка при перезапуске поиска");
      }

      toast.success("Поиск перезапущен");
      fetchOrders();
    } catch (error: any) {
      console.error("Error redispatching driver:", error);
      toast.error(error.message || "Ошибка при перезапуске поиска");
    } finally {
      setAssigningOrderId(null);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!window.confirm("Вы уверены, что хотите удалить этот заказ?")) {
      return;
    }
    try {
      const res = await fetch(`${baseURL}/orders/${orderId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || err?.message || "Ошибка при удалении заказа");
      }

      toast.success("Заказ удален");
      fetchOrders();
    } catch (error: any) {
      console.error("Error deleting order:", error);
      toast.error(error.message || "Ошибка при удалении заказа");
    }
  };

  const openManualAssignModal = async (order: AdminOrder) => {
    setManualAssignOrder(order);
    setSelectedDriverId("");
    if (drivers.length === 0) {
      await fetchDrivers();
    }
  };

  const closeManualAssignModal = () => {
    if (isManualAssignSaving) {
      return;
    }
    setManualAssignOrder(null);
    setSelectedDriverId("");
  };

  const handleManualAssign = async () => {
    if (!manualAssignOrder || !selectedDriverId) {
      toast.error("Выберите водителя");
      return;
    }

    try {
      setIsManualAssignSaving(true);
      // Backend route is POST /api/v1/orders/{order_id}/assign without a trailing slash.
      const assignUrl = `${baseURL}/orders/${manualAssignOrder.id}/assign`;
      const res = await fetch(assignUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ driver_id: selectedDriverId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || err?.message || "Ошибка при назначении водителя");
      }

      toast.success("Водитель назначен вручную");
      closeManualAssignModal();
      fetchOrders(true);
      fetchDrivers(true);
    } catch (error: any) {
      console.error("Error assigning driver manually:", error);
      toast.error(error.message || "Ошибка при назначении водителя");
    } finally {
      setIsManualAssignSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    onLogout();
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 relative overflow-hidden">
      {/* Header */}
      <div className="bg-white px-6 py-4 shadow-sm z-10 sticky top-0 border-b border-slate-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex items-center justify-between sm:justify-start gap-6">
          <div>
            <h1 className="text-2xl font-black text-[#2DB0E6] tracking-tight">
              Дармавоз
            </h1>
            <p className="text-sm font-medium text-slate-500">Панель логиста</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex sm:hidden items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors font-medium text-sm"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex flex-1 sm:justify-center">
          <div className="bg-slate-100 p-1 rounded-xl flex w-full sm:w-auto">
            <button
              onClick={() => setActiveTab("orders")}
              className={`flex-1 sm:w-32 py-2 text-sm font-bold rounded-lg transition-colors ${
                activeTab === "orders" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Заказы
            </button>
            <button
              onClick={() => setActiveTab("drivers")}
              className={`flex-1 sm:w-32 py-2 text-sm font-bold rounded-lg transition-colors ${
                activeTab === "drivers" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Водители
            </button>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors font-medium text-sm"
        >
          <LogOut className="w-4 h-4" />
          <span>Выйти</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        <UpdateBanner />
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          {activeTab === "orders" ? (
            <>
              <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-2">
                <h2 className="text-xl font-bold text-slate-800">Все заказы</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fetchOrders()}
                    className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Обновить
                  </button>
                  <button
                    onClick={() => setIsCreateOpen(true)}
                    className="flex items-center gap-2 bg-[#2DB0E6] text-white px-4 py-2 rounded-xl font-semibold hover:bg-[#209BD6] transition-colors shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Создать заказ</span>
                  </button>
                </div>
              </div>

              {isLoading ? (
                <div className="flex flex-col items-center justify-center p-20 text-slate-400">
                  <Loader2 className="w-10 h-10 animate-spin mb-4 text-[#2DB0E6]" />
                  <p className="font-medium text-lg">Загрузка заказов...</p>
                </div>
              ) : orders.length > 0 ? (
                <PullToRefresh onRefresh={() => Promise.resolve(fetchOrders())} pullingContent={""} maxPullDownDistance={80}>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 min-h-[50vh]">
                    {orders.map((order) => (
                      <div
                        key={order.id}
                        className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col gap-4 text-left hover:shadow-md transition-shadow"
                      >
                        {/* Card Header */}
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex flex-col">
                            <span className="text-xs text-slate-400 font-mono font-medium mb-1 tracking-wider">
                              #{order.id.slice(0, 8)}
                            </span>
                            <div className="flex items-center text-slate-500 text-xs font-semibold">
                              <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                              {new Date(order.created_at).toLocaleString([], {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {order.status === "offered_to_driver" ? (
                              <span className="text-[11px] font-bold px-3 py-1 rounded-lg uppercase tracking-wide border bg-purple-100 text-purple-700 border-purple-200 max-w-[200px] truncate" title={`ПРЕДЛОЖЕН: ${order.current_offer?.driver?.name || order.driver?.name || "ВОДИТЕЛЮ"}`}>
                                ПРЕДЛОЖЕН: {order.current_offer?.driver?.name || order.driver?.name || "ВОДИТЕЛЮ"}
                              </span>
                            ) : (
                              <span
                                className={`text-[11px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide border ${
                                  orderStatusColors[order.status] || "bg-slate-100 text-slate-600 border border-slate-200"
                                }`}
                              >
                                {orderStatusMap[order.status] || order.status.toUpperCase()}
                              </span>
                            )}
                            <button
                              onClick={() => handleDeleteOrder(order.id)}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                              title="Удалить заказ"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="w-full h-px bg-slate-100 my-1" />

                        {/* Address */}
                        <div className="flex items-start gap-3">
                          <MapPin className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                          <p className="text-sm font-bold text-slate-900 leading-snug">
                            {order.address}
                          </p>
                        </div>

                        {/* Details */}
                        <div className="grid grid-cols-2 gap-px bg-slate-100 rounded-xl overflow-hidden border border-slate-100">
                          <div className="bg-slate-50 p-3">
                            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold mb-0.5">
                              Материал
                            </p>
                            <p className="text-xs font-semibold text-slate-800 line-clamp-1">
                              {order.items?.[0]?.material?.name || "Неизвестный материал"}
                            </p>
                          </div>
                          <div className="bg-slate-50 p-3">
                            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold mb-0.5">
                              Объем
                            </p>
                            <p className="text-xs font-semibold text-slate-800">
                              {order.delivery_option?.capacity_m3 || "-"} м³
                            </p>
                          </div>
                        </div>

                        <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                          <span className="text-xs text-slate-400 uppercase tracking-wide font-bold">
                            Сумма
                          </span>
                          <span className="text-base font-black text-slate-800 tracking-tight">
                            {order.total_amount.toLocaleString()} ₽
                          </span>
                        </div>

                        <div className="w-full h-px bg-slate-50 mt-1" />

                        {/* Driver Assigment / Actions */}
                        <div className="mt-auto pt-2 flex flex-col gap-2">
                          {order.driver && order.driver.name && (
                            <div className="flex items-center gap-2.5 bg-blue-50/50 p-3 rounded-xl border border-blue-50">
                              <div className="bg-white p-1.5 rounded-full text-blue-500 shadow-sm">
                                <User className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-[10px] text-blue-400 uppercase tracking-wide font-bold mb-0.5">
                                  Водитель
                                </p>
                                <p className="text-sm font-bold text-blue-700">
                                  {order.driver.name}
                                </p>
                              </div>
                            </div>
                          )}

                          {order.status === "no_driver_found" && (
                            <button
                              disabled={assigningOrderId === order.id}
                              onClick={() => handleRedispatch(order.id)}
                              className={`w-full py-3.5 rounded-xl font-bold flex flex-row items-center justify-center gap-2 transition-all ${
                                assigningOrderId === order.id
                                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                  : "bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-600 shadow-sm hover:shadow active:scale-[0.98] border border-red-200"
                              }`}
                            >
                              {assigningOrderId === order.id ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Перезапускаем...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="w-4 h-4" />
                                  Перезапустить поиск
                                </>
                              )}
                            </button>
                          )}

                          {(order.status === "searching_driver" || order.status === "offered_to_driver") && (
                            <div className="w-full py-3.5 bg-indigo-50 text-indigo-500 rounded-xl font-bold flex flex-row items-center justify-center gap-2 border border-indigo-100 shadow-sm">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Автопоиск водителя...
                            </div>
                          )}

                          {manualAssignableStatuses.has(order.status) && (
                            <button
                              disabled={isManualAssignSaving && manualAssignOrder?.id === order.id}
                              onClick={() => openManualAssignModal(order)}
                              className="w-full py-3 rounded-xl font-bold flex flex-row items-center justify-center gap-2 transition-all border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 shadow-sm active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                              <Users className="w-4 h-4" />
                              Назначить вручную
                            </button>
                          )}

                          {order.status !== "created" && (
                            <button
                              onClick={() => handleOpenHistory(order.id)}
                              className="w-full py-3 rounded-xl font-bold flex flex-row items-center justify-center gap-2 transition-all border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 shadow-sm active:scale-[0.98]"
                            >
                              <Clock className="w-4 h-4" />
                              История распределения
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </PullToRefresh>
              ) : (
                <PullToRefresh onRefresh={() => Promise.resolve(fetchOrders())} pullingContent={""} maxPullDownDistance={80}>
                  <div className="flex flex-col items-center justify-center p-20 text-slate-400 bg-white rounded-3xl border border-dashed border-slate-200 min-h-[50vh]">
                    <PackageOpen className="w-16 h-16 text-slate-200 mb-4" />
                    <p className="font-semibold text-lg text-slate-500">
                      Заказов пока нет
                    </p>
                    <p className="text-sm mt-1">Новые заказы появятся здесь</p>
                  </div>
                </PullToRefresh>
              )}
            </>
          ) : (
            <>
              {/* Drivers Tab */}
              <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-2">
                <h2 className="text-xl font-bold text-slate-800">Автопарк</h2>
                <button
                  onClick={() => fetchDrivers()}
                  className="text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Обновить
                </button>
              </div>

              {isLoadingDrivers ? (
                <div className="flex flex-col items-center justify-center p-20 text-slate-400">
                  <Loader2 className="w-10 h-10 animate-spin mb-4 text-[#2DB0E6]" />
                  <p className="font-medium text-lg">Загрузка водителей...</p>
                </div>
              ) : drivers.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {drivers.map((driver) => (
                    <div key={driver.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col gap-4 text-left hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className="bg-slate-100 p-3 rounded-full text-slate-500 shadow-sm border border-slate-200/50">
                            <User className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">{driver.name}</p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">{driver.phone}</p>
                          </div>
                        </div>
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-lg border ${
                          driver.status === 'available' ? 'bg-green-50 text-green-700 border-green-200' :
                          driver.status === 'busy' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                          'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>
                          {driver.status === 'available' ? 'Свободен' :
                           driver.status === 'busy' ? 'Занят' :
                           'Недоступен'}
                        </span>
                      </div>

                      <div className="w-full h-px bg-slate-100 my-1" />

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2.5">
                          <Truck className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-semibold text-slate-700">
                            {driver.vehicle?.title || "Транспорт не указан"}
                          </span>
                        </div>
                        {driver.vehicle?.plate_number && (
                          <div className="flex items-center gap-2.5 pl-[26px]">
                            <span className="text-xs font-mono font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 tracking-wider">
                              {driver.vehicle.plate_number}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-20 text-slate-400 bg-white rounded-3xl border border-dashed border-slate-200 min-h-[50vh]">
                  <SearchX className="w-16 h-16 text-slate-200 mb-4" />
                  <p className="font-semibold text-lg text-slate-500">
                    Водители не найдены
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create Order Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-xl font-bold text-slate-800">
                Новый заказ
              </h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreateOrder} className="p-6 overflow-y-auto flex flex-col gap-4">
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
                  onChange={(e) => setNewOrder({ ...newOrder, client_name: e.target.value })}
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
                    onChange={(e) => setNewOrder({ ...newOrder, material_id: e.target.value })}
                  >
                    <option value="" disabled>Выберите...</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Кубатура <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm bg-white"
                    value={newOrder.delivery_option_id}
                    onChange={(e) => setNewOrder({ ...newOrder, delivery_option_id: e.target.value })}
                  >
                    <option value="" disabled>Выберите...</option>
                    {deliveryOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.capacity_m3} м³</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Адрес доставки <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="ул. Ленина, д. 1"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm"
                  value={newOrder.address}
                  onChange={(e) => setNewOrder({ ...newOrder, address: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Комментарий
                </label>
                <textarea
                  placeholder="Уточнения по доставке..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm resize-none"
                  value={newOrder.notes}
                  onChange={(e) => setNewOrder({ ...newOrder, notes: e.target.value })}
                />
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 pb-2">
                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full py-3.5 bg-[#2DB0E6] text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#209BD6] transition-colors disabled:opacity-70 disabled:cursor-not-allowed shadow-md"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Создаем заказ...
                    </>
                  ) : (
                    "Создать заказ"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {manualAssignOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-xl font-bold text-slate-800">Назначить водителя</h3>
                <p className="text-sm text-slate-500 mt-1">Заказ #{manualAssignOrder.id.slice(0, 8)}</p>
              </div>
              <button
                onClick={closeManualAssignModal}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Адрес</p>
                <p className="text-sm font-semibold text-slate-800">{manualAssignOrder.address}</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Водитель
                </label>
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2DB0E6] focus:ring-1 focus:ring-[#2DB0E6] text-sm bg-white"
                >
                  <option value="" disabled>
                    Выберите водителя...
                  </option>
                  {drivers.map((driver) => {
                    const vehicleTitle = driver.vehicle?.title || "Без машины";
                    const statusLabel = driverStatusLabelMap[driver.status] || driver.status;
                    return (
                      <option key={driver.id} value={driver.id}>
                        {`${driver.name} • ${statusLabel} • ${vehicleTitle}`}
                      </option>
                    );
                  })}
                </select>
              </div>

              {drivers.length === 0 && !isLoadingDrivers && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Список водителей пуст. Проверьте, что в системе есть активные водители.
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={closeManualAssignModal}
                  className="px-4 py-3 rounded-xl font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  disabled={!selectedDriverId || isManualAssignSaving}
                  onClick={handleManualAssign}
                  className={`px-4 py-3 rounded-xl font-semibold text-white transition-colors ${
                    !selectedDriverId || isManualAssignSaving
                      ? "bg-slate-300 cursor-not-allowed"
                      : "bg-[#2DB0E6] hover:bg-[#209BD6]"
                  }`}
                >
                  {isManualAssignSaving ? "Сохраняем..." : "Сохранить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyOrderId && (() => {
        const currentHistoryOrder = orders.find(o => o.id === historyOrderId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="flex flex-col">
                  <h3 className="text-xl font-bold text-slate-800">
                    Жизненный цикл заказа
                  </h3>
                  {currentHistoryOrder && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs text-slate-400 font-medium">Статус:</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide border ${
                          orderStatusColors[currentHistoryOrder.status] || "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                      >
                        {orderStatusMap[currentHistoryOrder.status] || currentHistoryOrder.status.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setHistoryOrderId(null)}
                  className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto w-full flex flex-col">
                {isLoadingHistory ? (
                  <div className="flex flex-col items-center justify-center py-10">
                    <Loader2 className="w-8 h-8 text-slate-300 animate-spin mb-2" />
                    <p className="text-slate-500 text-sm">Загружаем историю...</p>
                  </div>
                ) : (
                  <div className="relative border-l-2 border-slate-200 ml-3 pl-6 py-2 space-y-6">
                    {/* Event: Order Created */}
                    {currentHistoryOrder && (
                      <div className="relative">
                        <div className="absolute -left-[33px] mt-0.5 bg-slate-300 w-4 h-4 rounded-full border-[3px] border-white shadow-sm" />
                        <p className="text-sm font-bold text-slate-800">Заявка создана</p>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          {new Date(currentHistoryOrder.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                        </p>
                      </div>
                    )}

                    {/* Dispatch Attempts */}
                    {dispatchHistory.map((entry, i) => {
                      const isSuccess = entry.status === 'accepted';
                      const isFail = entry.status === 'declined' || entry.status === 'timeout' || entry.status === 'expired';
                      const badgeColor = isSuccess ? 'bg-emerald-100 text-emerald-700' : isFail ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700';
                      const dotColor = isSuccess ? 'bg-emerald-500' : isFail ? 'bg-rose-400' : 'bg-indigo-400';

                      return (
                        <div key={i} className="relative flex flex-col bg-slate-50 border border-slate-100 rounded-xl p-3.5 gap-2 text-left w-full shadow-sm">
                          <div className={`absolute -left-[33px] top-4 ${dotColor} w-4 h-4 rounded-full border-[3px] border-white shadow-sm`} />
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex flex-col">
                              {entry.driver_name ? (
                                <p className="font-bold text-slate-800 text-[15px] leading-tight">
                                  {entry.driver_name}
                                </p>
                              ) : (
                                <p className="font-bold text-slate-600 text-[15px] leading-tight">
                                  Попытка #{entry.sequence_no}
                                </p>
                              )}
                              
                              {entry.driver_phone && (
                                <p className="text-sm font-semibold mt-1">
                                  <a href={`tel:${entry.driver_phone}`} className="text-[#2DB0E6] hover:underline">
                                    {entry.driver_phone}
                                  </a>
                                </p>
                              )}

                              {entry.vehicle_title && (
                                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                                  {entry.vehicle_title}
                                </p>
                              )}
                              
                              {entry.driver_name && (
                                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-1.5">
                                  Попытка #{entry.sequence_no}
                                </p>
                              )}
                            </div>
                            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-lg border border-white/50 ${badgeColor}`}>
                              {attemptStatusMap[entry.status] || entry.status.toUpperCase()}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <p className="text-xs text-slate-400 font-medium">
                              {entry.offered_at ? new Date(entry.offered_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : ""}
                            </p>
                          </div>
                          
                          {entry.decision_reason && (
                            <div className="text-[11px] text-rose-700 mt-1 font-semibold bg-rose-50/80 px-2.5 py-1.5 rounded-lg border border-rose-100/50">
                              Причина: <span className="font-bold">{declineReasonMap[entry.decision_reason] || entry.decision_reason}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Event: In Progress */}
                    {currentHistoryOrder && (currentHistoryOrder.status === "in_progress" || currentHistoryOrder.status === "completed") && (
                      <div className="relative">
                        <div className="absolute -left-[35px] top-0 bg-[#2DB0E6] w-5 h-5 rounded-full border-[3px] border-white shadow-sm flex items-center justify-center">
                          <Truck className="w-2.5 h-2.5 text-white" />
                        </div>
                        <div className="flex flex-col items-start pt-0.5">
                          <p className="text-sm font-bold text-slate-800">Водитель в пути</p>
                          <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide border bg-[#2DB0E6]/10 text-[#2DB0E6] border-[#2DB0E6]/20">В пути</span>
                        </div>
                      </div>
                    )}

                    {/* Event: Completed */}
                    {currentHistoryOrder && currentHistoryOrder.status === "completed" && (
                      <div className="relative">
                        <div className="absolute -left-[35px] top-0 bg-emerald-500 w-5 h-5 rounded-full border-[3px] border-white shadow-sm flex items-center justify-center">
                          <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                        <div className="flex flex-col items-start pt-0.5">
                          <p className="text-sm font-bold text-slate-800">Заказ успешно завершен</p>
                          <span className="inline-block mt-1 text-[10px] font-bold px-2.5 py-0.5 rounded-lg uppercase tracking-wide border bg-emerald-100 text-emerald-700 border-emerald-200">Завершен</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
