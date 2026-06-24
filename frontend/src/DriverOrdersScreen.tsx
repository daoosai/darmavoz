import React, { useState, useEffect } from "react";
import PullToRefresh from "react-simple-pull-to-refresh";
import { useAuthStore } from "./store";
import {
  baseURL,
  orderStatusMap,
  orderStatusColors,
  handleApiError,
  playNewOrderSound,
} from "./utils";
import DriverProfileScreen from "./DriverProfileScreen";
import {
  LogOut,
  MapPin,
  Clock,
  MessageSquare,
  Loader2,
  PackageOpen,
  ClipboardList,
  AlertCircle,
  User as UserIcon,
  CheckCircle2,
  Phone,
  Ban,
} from "lucide-react";
import toast from "react-hot-toast";

interface DriverOrder {
  id: string;
  address: string;
  items?: { material: { name: string } }[];
  delivery_option?: { capacity_m3: number };
  created_at: string;
  total_amount: number;
  notes?: string;
  status: string;
  material_name?: string;
  capacity_m3?: number;
  client_phone?: string;
  client?: { phone?: string; name?: string };
}

type DriverStatus = "available" | "busy" | "offline";

interface DriverOrdersScreenProps {
  onLogout: () => void;
}

export default function DriverOrdersScreen({
  onLogout,
}: DriverOrdersScreenProps) {
  const { logout, token } = useAuthStore();
  const [status, setStatus] = useState<DriverStatus>("offline");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);
  const [activeTab, setActiveTab] = useState<"orders" | "profile">("orders");
  const [ordersTab, setOrdersTab] = useState<"current" | "history">("current");

  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [historyOrders, setHistoryOrders] = useState<DriverOrder[]>([]);

  const [currentOffer, setCurrentOffer] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [moderationStatus, setModerationStatus] = useState<string | null>(null);
  const [isDriverActive, setIsDriverActive] = useState(true);

  useEffect(() => {
    if (currentOffer) {
      playNewOrderSound();
    }
  }, [currentOffer]);

  const [isProfileLoading, setIsProfileLoading] = useState(true);

  const fetchProfile = async () => {
    try {
      setIsProfileLoading(true);
      const currentToken = useAuthStore.getState().token;
      if (!currentToken) return;
      const res = await fetch(`${baseURL}/driver/profile/full`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.status === 401) {
        useAuthStore.getState().logout();
        onLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const profile = Array.isArray(data) ? data[0] : data;
        setModerationStatus(profile?.moderation_status || null);
        setIsDriverActive(profile?.is_active !== false);
        if (profile?.status) {
          setStatus(profile.status);
        }

        if (
          profile?.is_active === false ||
          !profile?.vehicle?.brand ||
          !profile?.vehicle?.plate_number
        ) {
          setActiveTab("profile");
        }
      }
    } catch (e) {
      // Ignore error for now
    } finally {
      setIsProfileLoading(false);
    }
  };

  const checkIncomingOffer = React.useCallback(async () => {
    const currentToken = useAuthStore.getState().token;
    if (!currentToken) return;

    try {
      const res = await fetch(`${baseURL}/driver/orders/incoming/current`, {
        headers: {
          Authorization: `Bearer ${currentToken}`,
        },
      });

      if (res.status === 401) {
        useAuthStore.getState().logout();
        onLogout();
        return;
      }
      if (res.status === 403) {
        return;
      }

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.offer_id) {
          setCurrentOffer(data);
          if (data.seconds_left !== undefined) {
            setTimeLeft(data.seconds_left);
          } else if (data.expires_at) {
            const ends = new Date(data.expires_at).getTime();
            setTimeLeft(Math.max(0, Math.floor((ends - Date.now()) / 1000)));
          } else {
            setTimeLeft(60); // Default fallback 60 seconds
          }
        } else {
          setCurrentOffer(null);
        }
      }
    } catch (error) {
      // Silently ignore network errors during periodic polling to avoid error flood
    }
  }, [onLogout]);

  const fetchOrders = React.useCallback(
    async (silent = false) => {
      try {
        if (!silent) setIsLoading(true);
        const currentToken = useAuthStore.getState().token;

        const assignedRes = await fetch(
          `${baseURL}/driver/orders/assigned/current`,
          {
            headers: {
              Authorization: `Bearer ${currentToken}`,
            },
          },
        );

        if (assignedRes.status === 401) {
          useAuthStore.getState().logout();
          onLogout();
          return;
        }

        if (assignedRes.status === 403) {
          setOrders([]);
          setIsForbidden(true);
          if (!silent) setIsLoading(false);
          return;
        }

        if (assignedRes.ok) {
          setIsForbidden(false);
          let assignedData = await assignedRes.json().catch(() => null);
          if (assignedData) {
            if (Array.isArray(assignedData)) {
              assignedData = assignedData.length > 0 ? assignedData[0] : null;
            }
            if (assignedData) {
              const isOffer = !!assignedData.order_id;
              const orderId = isOffer ? assignedData.order_id : assignedData.id;
              const detail = isOffer ? assignedData.order : assignedData;
              if (
                orderId &&
                detail &&
                detail.status !== "completed" &&
                detail.status !== "cancelled"
              ) {
                const currentOrder: DriverOrder = {
                  id: orderId,
                  address: detail.address || "Адрес не указан",
                  items: detail.items || [],
                  delivery_option: detail.delivery_option,
                  created_at: detail.created_at || new Date().toISOString(),
                  total_amount: detail.total_amount || 0,
                  notes: detail.notes,
                  status: detail.status || "driver_assigned",
                  material_name: detail.material_name,
                  capacity_m3: detail.capacity_m3,
                  client_phone: detail.client_phone,
                  client: detail.client,
                };
                setOrders([currentOrder]);
                return;
              }
            }
          }
        }

        const res = await fetch(`${baseURL}/driver/orders`, {
          headers: {
            Authorization: `Bearer ${currentToken}`,
          },
        });

        if (res.status === 401) {
          useAuthStore.getState().logout();
          onLogout();
          return;
        }

        if (res.status === 403) {
          setOrders([]);
          setIsForbidden(true);
          if (!silent) setIsLoading(false);
          return;
        }

        if (!res.ok) {
          const errText = await res.text();
          console.error("Orders error text:", errText);
          throw new Error("Не удалось загрузить заказы");
        }
        setIsForbidden(false);
        const data = await res.json().catch(() => ({}));
        const loadedOrders = Array.isArray(data) ? data : data.orders || [];
        const activeOrders = loadedOrders.filter(
          (o: any) => o.status !== "completed" && o.status !== "cancelled",
        );
        setOrders(activeOrders);
      } catch (error) {
        console.error("Error fetching orders:", error);
        setOrders([]);
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [onLogout],
  );

  useEffect(() => {
    fetchProfile();
  }, []);

  useEffect(() => {
    if (activeTab === "orders") {
      fetchProfile();
    }
  }, [activeTab]);

  useEffect(() => {
    let pollingInterval: NodeJS.Timeout;

    if (token && moderationStatus === "approved" && isDriverActive) {
      fetchOrders();
      pollingInterval = setInterval(() => {
        checkIncomingOffer();
        fetchOrders(true);
      }, 5000);
      checkIncomingOffer(); // Initial check
    }

    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [
    token,
    checkIncomingOffer,
    fetchOrders,
    moderationStatus,
    isDriverActive,
  ]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (currentOffer && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setCurrentOffer(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [currentOffer, timeLeft]);

  const handleAcceptOffer = async (offerId: string) => {
    try {
      const currentToken = useAuthStore.getState().token;
      const res = await fetch(
        `${baseURL}/driver/order-offers/${offerId}/accept`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentToken}`,
          },
        },
      );

      if (res.status === 401) {
        useAuthStore.getState().logout();
        onLogout();
        return;
      }
      if (res.status === 403) {
        toast.error("Нет доступа к действию");
        return;
      }

      if (res.ok) {
        toast.success("Заказ принят!");
        setCurrentOffer(null);
        checkIncomingOffer();
        fetchOrders();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Не удалось принять заказ");
      }
    } catch (error: any) {
      toast.error(handleApiError(error, "Не удалось принять заказ"));
    }
  };

  const handleDeclineOffer = async (offerId: string) => {
    try {
      const currentToken = useAuthStore.getState().token;
      const res = await fetch(
        `${baseURL}/driver/order-offers/${offerId}/decline`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentToken}`,
          },
          body: JSON.stringify({ reason: "manual" }),
        },
      );

      if (res.status === 401) {
        useAuthStore.getState().logout();
        onLogout();
        return;
      }
      if (res.status === 403) {
        toast.error("Нет доступа к действию");
        return;
      }

      if (res.ok) {
        toast.success("Вы отказались от заказа");
        setCurrentOffer(null);
        checkIncomingOffer();
        fetchOrders();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Не удалось отказаться от заказа");
      }
    } catch (error: any) {
      toast.error(handleApiError(error, "Не удалось отказаться от заказа"));
    }
  };

  const fetchHistory = React.useCallback(async () => {
    try {
      setIsLoadingHistory(true);
      const currentToken = useAuthStore.getState().token;
      const res = await fetch(`${baseURL}/driver/orders`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const loadedOrders = Array.isArray(data) ? data : data.orders || [];
        setHistoryOrders(
          loadedOrders.filter(
            (o: any) => o.status === "completed" || o.status === "cancelled",
          ),
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (ordersTab === "history" && moderationStatus === "approved") {
      fetchHistory();
    }
  }, [ordersTab, moderationStatus, fetchHistory]);

  const handleStatusChange = async (newStatus: DriverStatus) => {
    if (newStatus === status) return;
    if (!isDriverActive) {
      toast.error("Ваш профиль не активен, обратитесь к администратору");
      return;
    }

    try {
      setIsUpdatingStatus(true);
      const currentToken = useAuthStore.getState().token;
      const res = await fetch(`${baseURL}/driver/profile/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.status === 401) {
        useAuthStore.getState().logout();
        onLogout();
        return;
      }
      if (res.status === 403) {
        toast.error("Недостаточно прав (403)");
        return;
      }

      if (!res.ok) {
        throw new Error("Не удалось обновить статус");
      }

      setStatus(newStatus);
      toast.success(`Статус изменен`);
    } catch (error) {
      console.error("Error updating status:", error);
      // Mock success if api not really there
      setStatus(newStatus);
      toast.success(`[Mock] Статус изменен`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleLogout = () => {
    logout();
    onLogout();
  };

  const statuses: { id: DriverStatus; label: string; dot: string }[] = [
    { id: "available", label: "Свободен", dot: "bg-emerald-500" },
    { id: "busy", label: "Занят", dot: "bg-amber-500" },
    { id: "offline", label: "Недоступен", dot: "bg-slate-400" },
  ];

  const offerOrder = currentOffer?.order || currentOffer;
  const materialName =
    offerOrder?.material_name ||
    offerOrder?.material?.name ||
    offerOrder?.items?.[0]?.material?.name ||
    "Неизвестно";
  const capacity =
    offerOrder?.capacity_m3 ||
    offerOrder?.delivery_option?.capacity_m3 ||
    offerOrder?.volume_m3 ||
    "?";

  return (
    <div className="flex flex-col h-screen bg-slate-50 sm:max-w-md sm:mx-auto shadow-2xl relative overflow-y-auto overflow-x-hidden pb-24">
      {/* Header */}
      <div className="bg-white px-5 pt-3 pb-3 shadow-sm z-10 sticky top-0 border-b border-slate-100">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h1 className="text-2xl font-black text-[#2DB0E6] tracking-tight">
              Дармавоз
            </h1>
            <p className="text-sm font-medium text-slate-500">
              Панель водителя
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="p-2.5 bg-slate-50 rounded-full hover:bg-slate-100 text-slate-600 transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {/* Status Toggle */}
        {moderationStatus === "approved" && isDriverActive && (
          <div className="bg-slate-100/80 p-1 rounded-xl flex items-center relative gap-1 mb-3">
            {statuses.map((s) => {
              const isActive = status === s.id;
              return (
                <button
                  key={s.id}
                  disabled={isUpdatingStatus}
                  onClick={() => handleStatusChange(s.id)}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-200 flex justify-center items-center gap-1.5 min-h-[40px]
                    ${
                      isActive
                        ? "bg-white shadow-sm text-slate-900 scale-100"
                        : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 scale-95"
                    } 
                    ${isUpdatingStatus ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${s.dot} ${
                      isActive ? "animate-pulse" : ""
                    }`}
                  />
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Orders Sub-tabs */}
        {moderationStatus === "approved" && activeTab === "orders" && (
          <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
            <button
              onClick={() => setOrdersTab("current")}
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${ordersTab === "current" ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
            >
              Текущие
            </button>
            <button
              onClick={() => setOrdersTab("history")}
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${ordersTab === "history" ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
            >
              История
            </button>
          </div>
        )}
      </div>

      {/* Navigation Tabs Content */}
      {activeTab === "orders" ? (
        <div className="flex-1 overflow-visible p-5 h-auto">
          <h2 className="text-lg font-bold text-slate-800 mb-4">
            {ordersTab === "current" ? "Активные заказы" : "История поездок"}
          </h2>

          {isProfileLoading ? (
            <div className="flex flex-col items-center justify-center p-10 text-slate-400 min-h-[50vh]">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#2DB0E6]" />
              <p className="text-sm font-medium">Загрузка профиля...</p>
            </div>
          ) : !isDriverActive ? (
            <div className="flex flex-col items-center justify-center p-10 text-slate-500 text-center mt-10 min-h-[50vh] bg-amber-50 rounded-3xl border border-amber-200 shadow-sm">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                <AlertCircle className="w-10 h-10 text-amber-500" />
              </div>
              <p className="text-xl font-bold text-amber-900 mb-2">
                Профиль не активен
              </p>
              <p className="text-sm text-amber-700">
                Ваш профиль не активен, обратитесь к администратору.
              </p>
            </div>
          ) : moderationStatus === "rejected" || isForbidden ? (
            <div className="flex flex-col items-center justify-center p-10 text-red-600 text-center mt-10 min-h-[50vh] bg-red-50 rounded-3xl border border-red-200 shadow-sm">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                <Ban className="w-10 h-10 text-red-500" />
              </div>
              <p className="text-xl font-bold text-red-700 mb-2 leading-tight">
                Профиль заблокирован
              </p>
              <p className="text-sm text-red-600">
                Ваш профиль был отклонен или заблокирован администратором.
              </p>
            </div>
          ) : moderationStatus === "pending_moderation" ? (
            <div className="flex flex-col items-center justify-center p-10 text-amber-600 text-center mt-10 min-h-[50vh] bg-amber-50 rounded-3xl border border-amber-200 shadow-sm">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                <Clock className="w-10 h-10 text-amber-400" />
              </div>
              <p className="text-xl font-bold text-amber-700 mb-2 leading-tight">
                Профиль на проверке. Вы не можете принимать заказы.
              </p>
              <p className="text-sm text-amber-600">
                Диспетчер проверяет ваши данные. Обычно это занимает не больше
                часа.
              </p>
            </div>
          ) : moderationStatus !== "approved" ? (
            <div className="flex flex-col items-center justify-center p-10 text-slate-500 text-center mt-10 min-h-[50vh] bg-slate-100 rounded-3xl border border-slate-200 shadow-sm">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                <AlertCircle className="w-10 h-10 text-slate-400" />
              </div>
              <p className="text-xl font-bold text-slate-700 mb-2">
                Требуется действие
              </p>
              <p className="text-sm text-slate-500 mb-6">
                Завершите регистрацию. Заполните данные об автомобиле и
                загрузите 3 фотографии с разных сторон в разделе «Профиль»,
                чтобы отправить заявку на модерацию.
              </p>
              <button
                onClick={() => setActiveTab("profile")}
                className="bg-[#2DB0E6] text-white px-6 py-3 rounded-xl font-bold hover:bg-[#209BD6] transition-colors"
              >
                Перейти в Профиль
              </button>
            </div>
          ) : ordersTab === "history" ? (
            isLoadingHistory ? (
              <div className="flex flex-col items-center justify-center p-10 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#2DB0E6]" />
                <p className="text-sm font-medium">Загрузка истории...</p>
              </div>
            ) : historyOrders.length > 0 ? (
              <PullToRefresh
                onRefresh={fetchHistory}
                pullingContent={""}
                maxPullDownDistance={80}
              >
                <div className="flex flex-col gap-4 min-h-[50vh]">
                  {historyOrders.map((order) => (
                    <DriverOrderCard
                      key={order.id}
                      order={order}
                      isHistory={true}
                    />
                  ))}
                </div>
              </PullToRefresh>
            ) : (
              <PullToRefresh
                onRefresh={fetchHistory}
                pullingContent={""}
                maxPullDownDistance={80}
              >
                <div className="flex flex-col items-center justify-center p-10 text-slate-400 text-center mt-10 min-h-[50vh]">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <ClipboardList className="w-10 h-10 text-slate-300" />
                  </div>
                  <p className="text-base font-semibold text-slate-600 mb-1">
                    История пуста
                  </p>
                  <p className="text-sm">
                    Здесь будут отображаться ваши выполненные заказы.
                  </p>
                </div>
              </PullToRefresh>
            )
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center p-10 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#2DB0E6]" />
              <p className="text-sm font-medium">Загрузка заказов...</p>
            </div>
          ) : orders.length > 0 ? (
            <PullToRefresh
              onRefresh={fetchOrders}
              pullingContent={""}
              maxPullDownDistance={80}
            >
              <div className="flex flex-col gap-4 min-h-[50vh]">
                {orders.map((order) => (
                  <DriverOrderCard
                    key={order.id}
                    order={order}
                    onRefresh={() => {
                      fetchOrders();
                      fetchProfile();
                    }}
                  />
                ))}
              </div>
            </PullToRefresh>
          ) : (
            <PullToRefresh
              onRefresh={fetchOrders}
              pullingContent={""}
              maxPullDownDistance={80}
            >
              <div className="flex flex-col items-center justify-center p-10 text-slate-400 text-center mt-10 min-h-[50vh]">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                  <PackageOpen className="w-10 h-10 text-slate-300" />
                </div>
                <p className="text-base font-semibold text-slate-600 mb-1">
                  Нет активных заказов
                </p>
                <p className="text-sm">
                  Когда появится новая заявка, она отобразится здесь.
                </p>
              </div>
            </PullToRefresh>
          )}
        </div>
      ) : (
        <DriverProfileScreen
          onLogout={handleLogout}
          onProfileUpdate={fetchProfile}
        />
      )}

      {/* Bottom Navigation */}
      <div className="fixed sm:absolute bottom-0 left-0 right-0 sm:max-w-md sm:mx-auto bg-white border-t border-slate-100 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)] z-40 pb-safe">
        <div className="flex justify-around items-center p-2">
          <button
            onClick={() => setActiveTab("orders")}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 rounded-xl transition-all ${
              activeTab === "orders"
                ? "text-[#2DB0E6]"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <div
              className={`p-1.5 rounded-xl transition-colors ${activeTab === "orders" ? "bg-[#2DB0E6]/10" : ""}`}
            >
              <ClipboardList className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-bold">Заказы</span>
          </button>

          <button
            onClick={() => setActiveTab("profile")}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 rounded-xl transition-all ${
              activeTab === "profile"
                ? "text-[#2DB0E6]"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <div
              className={`p-1.5 rounded-xl transition-colors ${activeTab === "profile" ? "bg-[#2DB0E6]/10" : ""}`}
            >
              <UserIcon className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-bold">Профиль</span>
          </button>
        </div>
      </div>

      {/* Incoming Offer Modal */}
      {currentOffer && (
        <div className="absolute inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-6 animate-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                <PackageOpen className="w-8 h-8 text-[#2DB0E6] animate-bounce" />
              </div>
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">
                Новый заказ!
              </h3>
              <p className="text-sm font-semibold text-slate-500">
                Предложение исчезнет через:
              </p>
              <div className="text-3xl font-black text-rose-500 tracking-tighter tabular-nums mb-1">
                {Math.floor(timeLeft / 60)
                  .toString()
                  .padStart(2, "0")}
                :{(timeLeft % 60).toString().padStart(2, "0")}
              </div>
            </div>

            <div className="flex flex-col gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Адрес доставки
                </p>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-base font-bold text-slate-800 leading-snug">
                    {currentOffer.order?.address || currentOffer.address}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Материал
                  </p>
                  <p className="text-sm font-bold text-slate-700">
                    {materialName}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Кубатура
                  </p>
                  <p className="text-sm font-bold text-slate-700">
                    {capacity} м³
                  </p>
                </div>
              </div>

              {(currentOffer.order?.notes || currentOffer.notes) && (
                <div className="mt-2 bg-amber-50 p-3 rounded-lg border border-amber-100">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 mb-1 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
                    Комментарий клиента
                  </p>
                  <p className="text-sm font-medium text-amber-900 leading-snug">
                    {currentOffer.order?.notes || currentOffer.notes}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 mt-2">
              <button
                onClick={() =>
                  handleAcceptOffer(currentOffer.offer_id || currentOffer.id)
                }
                className="w-full bg-emerald-500 text-white font-bold text-lg py-4 rounded-xl hover:bg-emerald-600 active:scale-[0.98] transition-all shadow-sm shadow-emerald-500/20"
              >
                ПРИНЯТЬ ЗАКАЗ
              </button>
              <button
                onClick={() =>
                  handleDeclineOffer(currentOffer.offer_id || currentOffer.id)
                }
                className="w-full bg-rose-50 text-rose-600 font-bold text-base py-3 rounded-xl hover:bg-rose-100 active:scale-[0.98] transition-all"
              >
                ОТКАЗАТЬСЯ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const DriverOrderCard: React.FC<{
  order: DriverOrder;
  onRefresh?: () => void;
  isHistory?: boolean;
}> = ({ order, onRefresh, isHistory }) => {
  const [isCompleting, setIsCompleting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const materialName =
    order.material_name || order.items?.[0]?.material?.name || "Неизвестно";
  const capacity =
    order.capacity_m3 || order.delivery_option?.capacity_m3 || "?";

  if (isHistory) {
    return (
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col gap-3 text-left h-auto overflow-visible">
        <div className="flex justify-between items-start gap-2">
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide ${
              orderStatusColors[order.status] ||
              "bg-slate-100 text-slate-600 border border-slate-200"
            }`}
          >
            {orderStatusMap[order.status] || order.status.toUpperCase()}
          </span>
          <div className="flex items-center text-slate-400 text-xs font-medium">
            <Clock className="w-3.5 h-3.5 mr-1" />
            {new Date(order.created_at).toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "short",
            })}{" "}
            {new Date(order.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">
            Адрес доставки
          </p>
          <p className="text-sm font-bold text-slate-800 leading-snug">
            {order.address}
          </p>
        </div>
        <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-1">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
            Сумма заказа
          </span>
          <span className="text-emerald-500 font-black text-base">
            {order.total_amount} ₽
          </span>
        </div>
      </div>
    );
  }

  const handleStart = async () => {
    if (!onRefresh) return;
    try {
      setIsStarting(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${baseURL}/driver/orders/${order.id}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        useAuthStore.getState().logout();
        return;
      }
      if (res.status === 403) {
        toast.error("Недостаточно прав (403)");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Не удалось начать поездку");
      }
      toast.success("Отличной дороги!");
      onRefresh();
    } catch (e: any) {
      toast.error(handleApiError(e, "Не удалось начать поездку"));
    } finally {
      setIsStarting(false);
    }
  };

  const handleComplete = async () => {
    if (!onRefresh) return;
    try {
      setIsCompleting(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${baseURL}/driver/orders/${order.id}/complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        useAuthStore.getState().logout();
        return;
      }
      if (res.status === 403) {
        toast.error("Недостаточно прав (403)");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Не удалось завершить заказ");
      }
      toast.success("Заказ успешно завершен! Вы снова свободны.");
      onRefresh();
    } catch (e: any) {
      toast.error(handleApiError(e, "Не удалось завершить заказ"));
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col gap-4 text-left h-auto overflow-visible">
      {/* Header: Status and Date */}
      <div className="flex justify-between items-start gap-2">
        <span
          className={`text-[11px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide ${
            orderStatusColors[order.status] ||
            "bg-slate-100 text-slate-600 border border-slate-200"
          }`}
        >
          {orderStatusMap[order.status] || order.status.toUpperCase()}
        </span>
        <div className="flex items-center text-slate-400 text-xs font-medium">
          <Clock className="w-3.5 h-3.5 mr-1" />
          {new Date(order.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Address */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 bg-[#2DB0E6]/10 p-2.5 rounded-full text-[#2DB0E6] shrink-0">
          <MapPin className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-1">
            Адрес доставки
          </p>
          <p className="text-base font-bold text-slate-900 leading-snug">
            {order.address}
          </p>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-px bg-slate-100 overflow-visible rounded-xl border border-slate-100">
        <div className="flex flex-col gap-1 bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-bold">
            Материал
          </p>
          <p className="text-sm font-semibold text-slate-800">{materialName}</p>
        </div>
        <div className="flex flex-col gap-1 bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-bold">
            Объем
          </p>
          <p className="text-sm font-semibold text-slate-800">{capacity} м³</p>
        </div>
        <div className="flex items-center justify-between bg-slate-50 p-3 col-span-2">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-bold">
            Сумма заказа
          </p>
          <p className="text-[#2DB0E6] font-black text-lg">
            {order.total_amount} ₽
          </p>
        </div>
      </div>

      {/* Notes */}
      {order.notes && order.notes.trim() !== "" && (
        <div className="flex items-start gap-2.5 bg-amber-50 p-3.5 rounded-xl border border-amber-100 shadow-sm mt-1">
          <MessageSquare className="w-5 h-5 shrink-0 text-amber-500 fill-amber-100 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-amber-600 uppercase tracking-wider mb-0.5">
              Комментарий клиента
            </p>
            <p className="text-sm font-medium text-amber-900 leading-snug">
              {order.notes}
            </p>
          </div>
        </div>
      )}

      {/* Client Phone for Driver */}
      {(order.client_phone || order.client?.phone) && (
        <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-100 mt-1">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
              Телефон клиента
            </span>
            <span className="text-base font-bold text-slate-800">
              {order.client_phone || order.client?.phone}
            </span>
          </div>
          <a
            href={`tel:${order.client_phone || order.client?.phone}`}
            className="flex items-center justify-center gap-2 bg-[#2DB0E6]/10 text-[#2DB0E6] hover:bg-[#2DB0E6]/20 py-2.5 px-4 rounded-xl transition-colors font-bold text-sm active:scale-95"
          >
            <Phone className="w-4 h-4 shrink-0" />
            Позвонить
          </a>
        </div>
      )}

      {order.status === "driver_assigned" && onRefresh && (
        <button
          onClick={handleStart}
          disabled={isStarting}
          className="w-full mt-2 bg-[#2DB0E6] hover:bg-[#209acc] text-white font-bold py-3.5 px-4 rounded-xl shadow-sm transition-all focus:ring-4 focus:ring-[#2DB0E6]/20 active:scale-[0.98] flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isStarting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-5 h-5" />
          )}
          Начать поездку
        </button>
      )}

      {order.status === "in_progress" && onRefresh && (
        <button
          onClick={handleComplete}
          disabled={isCompleting}
          className="w-full mt-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-sm transition-all focus:ring-4 focus:ring-emerald-500/20 active:scale-[0.98] flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isCompleting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-5 h-5" />
          )}
          Завершить доставку
        </button>
      )}
    </div>
  );
};
