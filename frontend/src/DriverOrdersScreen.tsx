import React, { useState, useEffect, useRef } from "react";
import PullToRefresh from "react-simple-pull-to-refresh";
import { useAuthStore } from "./store";
import { getOrderStatusText } from "./utils/statusMapper";
import {
  baseURL,
  extractApiErrorMessage,
  
  orderStatusColors,
  handleApiError,
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
  Navigation,
} from "lucide-react";
import toast from "react-hot-toast";
import { logoutCurrentSession } from "./pushAuth";

export interface DriverOrder {
  id: string;
  address: string;
  items?: { material: { name: string } }[];
  delivery_option?: { capacity_m3: number };
  created_at: string;
  total_amount: number;
  delivery_cost?: number;
  estimated_total_amount?: number;
  notes?: string;
  status: string;
  material_name?: string;
  capacity_m3?: number;
  client_phone?: string;
  client?: { phone?: string; name?: string; full_name?: string };
  pickup_address?: string;
  pickup_lat?: number;
  pickup_lon?: number;
  delivery_address?: string;
  delivery_lat?: number;
  delivery_lon?: number;
  client_name?: string;
  quarry_name?: string;
  pickup_point_type?: string;
  quarry?: { name: string };
}

const getDeliveryCost = (order: Pick<DriverOrder, "delivery_cost">) =>
  Number(order.delivery_cost ?? 0);

const getEstimatedTotalAmount = (
  order: Pick<DriverOrder, "delivery_cost" | "estimated_total_amount" | "total_amount">,
) =>
  Number(order.estimated_total_amount ?? 0) ||
  Number(order.total_amount ?? 0) + getDeliveryCost(order);

const formatCurrency = (value?: number | null) =>
  `${Number(value ?? 0).toLocaleString("ru-RU")} ₽`;

type DriverStatus = "available" | "busy" | "offline";

interface DriverOrdersScreenProps {
  onLogout: () => void;
}

export default function DriverOrdersScreen({
  onLogout,
}: DriverOrdersScreenProps) {
  const { token } = useAuthStore();
  const [status, setStatus] = useState<DriverStatus>("offline");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [activeTab, setActiveTab] = useState<"orders" | "profile">("orders");

  const [orders, setOrders] = useState<DriverOrder[]>([]);

  const [currentOffer, setCurrentOffer] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [moderationStatus, setModerationStatus] = useState<string | null>(null);
  const [isDriverActive, setIsDriverActive] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playCount = useRef(0);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  useEffect(() => {
    if (currentOffer) {
      const audio = new Audio("/new_order.mp3");
      audioRef.current = audio;
      playCount.current = 0;

      const handleEnded = () => {
        playCount.current += 1;
        if (playCount.current < 3) {
          audio.play().catch((err) => console.log("Audio play error:", err));
        }
      };

      audio.addEventListener("ended", handleEnded);

      audio.play().catch((err) => console.log("Autoplay blocked:", err));

      return () => {
        audio.removeEventListener("ended", handleEnded);
        audio.pause();
        audio.currentTime = 0;
      };
    } else {
      stopAudio();
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
        await logoutCurrentSession();
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
        await logoutCurrentSession();
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
          await logoutCurrentSession();
          onLogout();
          return;
        }

        if (assignedRes.status === 403) {
          if (!silent) setIsLoading(false);
          return;
        }

        if (assignedRes.ok) {
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
                  delivery_cost: detail.delivery_cost,
                  estimated_total_amount: detail.estimated_total_amount,
                  notes: detail.notes,
                  status: detail.status || "driver_assigned",
                  material_name: detail.material_name,
                  capacity_m3: detail.capacity_m3,
                  client_phone: detail.client_phone || detail.client?.phone,
                  client: detail.client,
                  pickup_lat: detail.pickup_lat,
                  pickup_lon: detail.pickup_lon,
                  pickup_address: detail.pickup_address,
                  delivery_lat: detail.delivery_lat,
                  delivery_lon: detail.delivery_lon,
                  delivery_address: detail.delivery_address,
                  client_name: detail.client_name,
                  quarry_name: detail.quarry_name,
                  pickup_point_type: detail.pickup_point_type,
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
          await logoutCurrentSession();
          onLogout();
          return;
        }

        if (res.status === 403) {
          if (!silent) setIsLoading(false);
          return;
        }

        if (!res.ok) {
          const errText = await res.text();
          console.error("Orders error text:", errText);
          throw new Error("Не удалось загрузить заказы");
        }
        const data = await res.json().catch(() => ({}));
        const loadedOrders = Array.isArray(data) ? data : data.orders || [];
        const activeOrders = loadedOrders.filter(
          (o: any) => o.status !== "completed" && o.status !== "cancelled",
        );
        setOrders(activeOrders);
      } catch (error) {
        console.error("Error fetching orders:", error);
        toast.error("Ошибка при загрузке заказов");
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
    if (typeof window === "undefined") {
      return;
    }

    const handleRefreshOrders = () => {
      checkIncomingOffer();
      fetchOrders(true);
    };

    window.addEventListener("refresh_orders", handleRefreshOrders);

    return () => {
      window.removeEventListener("refresh_orders", handleRefreshOrders);
    };
  }, [checkIncomingOffer, fetchOrders]);

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
    stopAudio();
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
        await logoutCurrentSession();
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
        throw new Error(extractApiErrorMessage(err, "Не удалось принять заказ"));
      }
    } catch (error: any) {
      toast.error(handleApiError(error, "Не удалось принять заказ"));
    }
  };

  const handleDeclineOffer = async (offerId: string) => {
    stopAudio();
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
        await logoutCurrentSession();
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
        throw new Error(
          extractApiErrorMessage(err, "Не удалось отказаться от заказа"),
        );
      }
    } catch (error: any) {
      toast.error(handleApiError(error, "Не удалось отказаться от заказа"));
    }
  };

  const handleLogout = async () => {
    await logoutCurrentSession();
    onLogout();
  };

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
  const offerPickupAddress = offerOrder?.pickup_address || "Точка забора уточняется";
  const offerDeliveryAddress =
    offerOrder?.delivery_address || offerOrder?.address || "Адрес не указан";
  const offerDeliveryCost = Number(offerOrder?.delivery_cost ?? 0);
  const offerEstimatedTotalAmount = getEstimatedTotalAmount(offerOrder || { total_amount: 0 });

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 sm:max-w-md sm:mx-auto shadow-2xl relative overflow-y-auto overflow-x-hidden pb-28">
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

      </div>

      {/* Navigation Tabs Content */}
      {activeTab === "orders" ? (
        <div className="flex-1 overflow-visible p-5 h-auto">
          <h2 className="text-lg font-bold text-slate-800 mb-4">
            Активные заказы
          </h2>

          {isProfileLoading ? (
            <div className="flex flex-col items-center justify-center p-10 text-slate-400 min-h-[50vh]">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#2DB0E6]" />
              <p className="text-sm font-medium">Загрузка профиля...</p>
            </div>
          ) : !isDriverActive || moderationStatus === "rejected" ? (
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
          hasActiveOrder={orders.length > 0}
        />
      )}

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 w-full bg-white z-[9999] border-t border-gray-200 pb-safe">
        <div className="flex justify-around items-center p-2 sm:max-w-md sm:mx-auto">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-sm bg-white rounded-2xl flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-4 flex flex-col gap-3">
              <div className="flex flex-col items-center text-center gap-1">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-0.5">
                  <PackageOpen className="w-6 h-6 text-[#2DB0E6] animate-bounce" />
                </div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight">
                  Новый заказ!
                </h3>
                <div className="text-2xl font-black text-rose-500 tracking-tighter tabular-nums mt-1">
                  {Math.floor(timeLeft / 60)
                    .toString()
                    .padStart(2, "0")}
                  :{(timeLeft % 60).toString().padStart(2, "0")}
                </div>
              </div>

              <div className="flex flex-col gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                    Карьер
                  </p>
                  <div className="flex items-start gap-1.5">
                    <Navigation className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <p className="text-sm font-bold text-slate-800 leading-snug">
                      {offerPickupAddress}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                    Адрес доставки
                  </p>
                  <div className="flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <p className="text-sm font-bold text-slate-800 leading-snug">
                      {offerDeliveryAddress}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                      Материал
                    </p>
                    <p className="text-sm font-bold text-slate-700">
                      {materialName}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                      Кубатура
                    </p>
                    <p className="text-sm font-bold text-slate-700">
                      {capacity} м³
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>Сумма заказа</span>
                    <span className="text-slate-800">
                      {formatCurrency(offerOrder?.total_amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>Доставка</span>
                    <span className="text-slate-800">
                      {formatCurrency(offerDeliveryCost)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-bold text-slate-700">
                    <span>Итого</span>
                    <span className="text-[#2DB0E6]">
                      {formatCurrency(offerEstimatedTotalAmount)}
                    </span>
                  </div>
                </div>

                {(currentOffer.order?.notes || currentOffer.notes) && (
                  <div className="mt-0.5 bg-amber-50 p-2.5 rounded-lg border border-amber-100">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-0.5 flex items-center gap-1.5">
                      <MessageSquare className="w-3 h-3" />
                      Комментарий
                    </p>
                    <p className="text-xs font-medium text-amber-900 leading-snug line-clamp-2">
                      {currentOffer.order?.notes || currentOffer.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 pb-4 flex flex-col gap-2">
              <button
                onClick={() =>
                  handleAcceptOffer(currentOffer.offer_id || currentOffer.id)
                }
                className="w-full bg-emerald-500 text-white font-bold text-lg h-12 rounded-xl hover:bg-emerald-600 active:scale-[0.98] transition-all shadow-sm shadow-emerald-500/20"
              >
                ПРИНЯТЬ ЗАКАЗ
              </button>
              <button
                onClick={() =>
                  handleDeclineOffer(currentOffer.offer_id || currentOffer.id)
                }
                className="w-full bg-rose-50 text-rose-600 font-bold text-base h-12 rounded-xl hover:bg-rose-100 active:scale-[0.98] transition-all"
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

const CANCEL_REASONS = [
  "Сломалась машина",
  "Не успеваю по времени",
  "Прокол колеса / ДТП",
  "Не устраивает маршрут",
  "Другое",
];

export const DriverOrderCard: React.FC<{
  order: DriverOrder;
  onRefresh?: () => void;
  isHistory?: boolean;
}> = ({ order, onRefresh, isHistory }) => {
  const [isUpdating, setIsUpdating] = useState(false);

  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  const materialName =
    order.material_name || order.items?.[0]?.material?.name || "Неизвестно";
  const capacity =
    order.capacity_m3 || order.delivery_option?.capacity_m3 || "?";
  const deliveryCost = getDeliveryCost(order);
  const estimatedTotalAmount = getEstimatedTotalAmount(order);
  const materialCost = estimatedTotalAmount - deliveryCost;
  const clientPhone = order.client_phone || order.client?.phone;
  const clientName = order.client_name || order.client?.name || order.client?.full_name || "Имя не указано";
  const quarryName = order.quarry_name || order.quarry?.name || (order.pickup_address && !order.pickup_address.includes('57.') ? order.pickup_address : 'Точка погрузки');

  const updateStatus = async (step: string) => {
    if (!onRefresh) return;

    try {
      setIsUpdating(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(
        `${baseURL}/driver/orders/${order.id}/status`,
        {
          method: "PATCH",
          headers: { 
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}` 
          },
          body: JSON.stringify({ status: step }),
        },
      );
      if (res.status === 401) {
        await logoutCurrentSession();
        return;
      }
      if (res.status === 403) {
        toast.error("Недостаточно прав (403)");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          extractApiErrorMessage(err, "Не удалось обновить статус"),
        );
      }
      toast.success(step === "completed" ? "Заказ успешно завершен! Вы снова свободны." : "Статус обновлен");
      onRefresh();
    } catch (e: any) {
      toast.error(handleApiError(e, "Ошибка при обновлении статуса"));
    } finally {
      setIsUpdating(false);
    }
  };

  const openNavigator = (type: 'quarry' | 'client') => {
    const isToClient = type === 'client';
    const lat = isToClient ? order.delivery_lat : order.pickup_lat;
    const lon = isToClient ? order.delivery_lon : order.pickup_lon;
    const address = isToClient ? order.delivery_address : order.pickup_address;
    const label = isToClient
      ? "Клиент"
      : order.pickup_point_type === "accumulator"
        ? "Накопитель"
        : "Карьер";

    const isIOS = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    if (isToClient && address) {
      if (isIOS) {
        window.open(
          `https://2gis.ru/routeSearch/rsType/car/to/${encodeURIComponent(address)}`,
          "_blank",
        );
        return;
      }

      const isAndroid = /Android/i.test(navigator.userAgent);
      if (isAndroid) {
        window.location.href = `geo:0,0?q=${encodeURIComponent(address)}`;
        return;
      }

      window.open(
        `https://2gis.ru/routeSearch/rsType/car/to/${encodeURIComponent(address)}`,
        "_blank",
      );
      return;
    }

    if (lat == null || lon == null) {
      toast.error("Нет данных для построения маршрута");
      return;
    }

    if (isIOS) {
      window.open(
        `https://2gis.ru/routeSearch/rsType/car/to/${lon},${lat}`,
        "_blank",
      );
      return;
    }

    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      window.location.href = `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(label)})`;
      return;
    }

    const destinationUrl = `https://2gis.ru/routeSearch/rsType/car/to/${lon},${lat}`;

    window.open(destinationUrl, "_blank");
  };


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
            {getOrderStatusText(order.status) || order.status.toUpperCase()}
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
            {formatCurrency(order.total_amount)}
          </span>
        </div>
        <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
            Доставка
          </span>
          <span className="text-slate-800 font-black text-base">
            {formatCurrency(deliveryCost)}
          </span>
        </div>
        <div className="flex justify-between items-center bg-blue-50 p-2.5 rounded-xl border border-blue-100">
          <span className="text-[11px] text-blue-500 font-bold uppercase tracking-wider">
            Итого
          </span>
          <span className="text-[#2DB0E6] font-black text-base">
            {formatCurrency(estimatedTotalAmount)}
          </span>
        </div>
      </div>
    );
  }

  const handleCancelOrder = async () => {
    if (!onRefresh) return;

    const finalReason =
      selectedReason === "Другое" ? customReason : selectedReason;
    if (!finalReason.trim()) return;

    try {
      setIsCancelling(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${baseURL}/orders/${order.id}/driver-cancel`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: finalReason }),
      });
      if (res.status === 401) {
        await logoutCurrentSession();
        return;
      }
      if (res.status === 403) {
        toast.error("Недостаточно прав (403)");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractApiErrorMessage(err, "Не удалось отменить заказ"));
      }
      toast.success("Заказ отменен");
      setIsCancelModalOpen(false);
      setSelectedReason("");
      setCustomReason("");
      onRefresh(); // This clears the order state and loads the empty state
    } catch (e: any) {
      toast.error(handleApiError(e, "Не удалось отменить заказ"));
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col h-auto overflow-visible mb-6">
        {/* Header: Status and Date */}
        <div className="flex justify-between items-start mb-4">
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide ${
              orderStatusColors[order.status] ||
              "bg-slate-100 text-slate-600 border border-slate-200"
            }`}
          >
            {getOrderStatusText(order.status) || order.status.toUpperCase()}
          </span>
          <div className="flex items-center text-slate-400 text-xs font-medium">
            <Clock className="w-3.5 h-3.5 mr-1" />
            {new Date(order.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>

        {/* Addresses */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 bg-emerald-500/10 p-2 rounded-full text-emerald-600 shrink-0">
              <Navigation className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">
                Откуда (Карьер)
              </p>
              <div className="font-semibold text-gray-900">
                {quarryName}
              </div>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="mt-0.5 bg-[#2DB0E6]/10 p-2 rounded-full text-[#2DB0E6] shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">
                Куда (Клиент)
              </p>
              <p className="text-sm font-bold text-slate-900 leading-snug">
                {order.delivery_address || order.address}
              </p>
            </div>
          </div>
        </div>

        {/* Material & Volume */}
        <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-xl mt-4">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Материал</span>
            <span className="text-sm font-bold text-slate-800">{materialName}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Объем</span>
            <span className="text-sm font-bold text-slate-800">{capacity} м³</span>
          </div>
        </div>

        {/* Client Info */}
        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl mt-2">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Клиент</span>
            <div className="font-semibold text-gray-900">{clientName}</div>
          </div>
          {clientPhone && (
            <a href={`tel:${clientPhone}`} className="text-sm font-bold text-[#2DB0E6] flex items-center gap-1.5">
              <Phone className="w-4 h-4" />
              {clientPhone}
            </a>
          )}
        </div>

        {/* Notes */}
        {order.notes && order.notes.trim() !== "" && (
          <div className="bg-yellow-50 text-yellow-800 p-3 rounded-xl mt-2 text-sm font-medium">
             <span className="font-bold uppercase tracking-wider text-[10px] block mb-1">Комментарий:</span>
             {order.notes}
          </div>
        )}

        {/* Total Amount */}
        <div className="flex flex-col items-end mt-4 pb-4 border-b border-gray-100 space-y-1">
          <span className="text-sm text-gray-500 font-medium">
            Материал: {formatCurrency(materialCost)}
          </span>
          <span className="text-sm text-gray-500 font-medium">
            Доставка: {formatCurrency(deliveryCost)}
          </span>
          <span className="text-2xl font-bold text-[#2DB0E6] mt-2">
            Итого: {formatCurrency(estimatedTotalAmount)}
          </span>
        </div>

        {/* Action Buttons */}
        {onRefresh && (
          <div className="mt-4 flex flex-col gap-3">
            {(order.status === "driver_assigned" || order.status === "driver_accepted") && (
              <>
                <button
                  disabled={isUpdating}
                  onClick={() => updateStatus("heading_to_pickup")}
                  className="w-full h-14 bg-sky-500 active:bg-sky-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isUpdating ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Выехать на карьер"
                  )}
                </button>
                <button
                  onClick={() => openNavigator('quarry')}
                  className="w-full h-14 bg-gradient-to-r from-emerald-700 to-emerald-500 active:from-emerald-800 active:to-emerald-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  Открыть навигатор
                </button>
                <button
                  onClick={() => setIsCancelModalOpen(true)}
                  className="w-full py-4 text-red-500 font-medium text-base active:bg-red-50 rounded-xl transition-colors"
                >
                  Отказаться от выполнения
                </button>
              </>
            )}

            {order.status === "heading_to_pickup" && (
              <>
                <button
                  onClick={() => openNavigator('quarry')}
                  className="w-full h-14 bg-gradient-to-r from-emerald-700 to-emerald-500 active:from-emerald-800 active:to-emerald-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  Открыть навигатор
                </button>
                <button
                  disabled={isUpdating}
                  onClick={() => updateStatus("arrived_at_pickup")}
                  className="w-full h-14 bg-sky-500 active:bg-sky-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isUpdating ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Прибыл на карьер"
                  )}
                </button>
              </>
            )}

            {order.status === "arrived_at_pickup" && (
              <>
                <button
                  disabled={isUpdating}
                  onClick={() => updateStatus("heading_to_client")}
                  className="w-full h-14 bg-sky-500 active:bg-sky-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isUpdating ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Загрузился, еду к клиенту"
                  )}
                </button>
              </>
            )}

            {order.status === "heading_to_client" && (
              <>
                <button
                  onClick={() => openNavigator('client')}
                  className="w-full h-14 bg-gradient-to-r from-emerald-700 to-emerald-500 active:from-emerald-800 active:to-emerald-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  Открыть навигатор
                </button>
                <button
                  disabled={isUpdating}
                  onClick={() => updateStatus("completed")}
                  className="w-full h-14 bg-sky-500 active:bg-sky-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isUpdating ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Завершить заказ"
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 z-[99999] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-slate-800">
              Укажите причину отказа
            </h3>

            <div className="flex flex-wrap gap-2">
              {CANCEL_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={() => setSelectedReason(reason)}
                  className={`text-sm px-3 py-2 rounded-lg border transition-all ${
                    selectedReason === reason
                      ? "bg-rose-50 border-rose-500 text-rose-700 font-semibold"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            {selectedReason === "Другое" && (
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Опишите причину отказа..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 min-h-[100px] resize-none"
              />
            )}

            <div className="flex flex-col gap-2 mt-2">
              <button
                onClick={handleCancelOrder}
                disabled={
                  isCancelling ||
                  !selectedReason ||
                  (selectedReason === "Другое" && !customReason.trim())
                }
                className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-sm transition-all flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
                Подтвердить отказ
              </button>
              <button
                onClick={() => setIsCancelModalOpen(false)}
                disabled={isCancelling}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 px-4 rounded-xl transition-all"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

