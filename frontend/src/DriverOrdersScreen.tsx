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
  `${Number(value ?? 0).toLocaleString("ru-RU")} в‚Ѕ`;

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
                  address: detail.address || "РђРґСЂРµСЃ РЅРµ СѓРєР°Р·Р°РЅ",
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
          if (!silent) setIsLoading(false);
          return;
        }

        if (!res.ok) {
          const errText = await res.text();
          console.error("Orders error text:", errText);
          throw new Error("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р·Р°РєР°Р·С‹");
        }
        const data = await res.json().catch(() => ({}));
        const loadedOrders = Array.isArray(data) ? data : data.orders || [];
        const activeOrders = loadedOrders.filter(
          (o: any) => o.status !== "completed" && o.status !== "cancelled",
        );
        setOrders(activeOrders);
      } catch (error) {
        console.error("Error fetching orders:", error);
        toast.error("РћС€РёР±РєР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ Р·Р°РєР°Р·РѕРІ");
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
        useAuthStore.getState().logout();
        onLogout();
        return;
      }
      if (res.status === 403) {
        toast.error("РќРµС‚ РґРѕСЃС‚СѓРїР° Рє РґРµР№СЃС‚РІРёСЋ");
        return;
      }

      if (res.ok) {
        toast.success("Р—Р°РєР°Р· РїСЂРёРЅСЏС‚!");
        setCurrentOffer(null);
        checkIncomingOffer();
        fetchOrders();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractApiErrorMessage(err, "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРЅСЏС‚СЊ Р·Р°РєР°Р·"));
      }
    } catch (error: any) {
      toast.error(handleApiError(error, "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРЅСЏС‚СЊ Р·Р°РєР°Р·"));
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
        useAuthStore.getState().logout();
        onLogout();
        return;
      }
      if (res.status === 403) {
        toast.error("РќРµС‚ РґРѕСЃС‚СѓРїР° Рє РґРµР№СЃС‚РІРёСЋ");
        return;
      }

      if (res.ok) {
        toast.success("Р’С‹ РѕС‚РєР°Р·Р°Р»РёСЃСЊ РѕС‚ Р·Р°РєР°Р·Р°");
        setCurrentOffer(null);
        checkIncomingOffer();
        fetchOrders();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          extractApiErrorMessage(err, "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєР°Р·Р°С‚СЊСЃСЏ РѕС‚ Р·Р°РєР°Р·Р°"),
        );
      }
    } catch (error: any) {
      toast.error(handleApiError(error, "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєР°Р·Р°С‚СЊСЃСЏ РѕС‚ Р·Р°РєР°Р·Р°"));
    }
  };

  const handleLogout = () => {
    logout();
    onLogout();
  };

  const offerOrder = currentOffer?.order || currentOffer;
  const materialName =
    offerOrder?.material_name ||
    offerOrder?.material?.name ||
    offerOrder?.items?.[0]?.material?.name ||
    "РќРµРёР·РІРµСЃС‚РЅРѕ";
  const capacity =
    offerOrder?.capacity_m3 ||
    offerOrder?.delivery_option?.capacity_m3 ||
    offerOrder?.volume_m3 ||
    "?";
  const offerPickupAddress = offerOrder?.pickup_address || "РљР°СЂСЊРµСЂ СѓС‚РѕС‡РЅСЏРµС‚СЃСЏ";
  const offerDeliveryAddress =
    offerOrder?.delivery_address || offerOrder?.address || "РђРґСЂРµСЃ РЅРµ СѓРєР°Р·Р°РЅ";
  const offerDeliveryCost = Number(offerOrder?.delivery_cost ?? 0);
  const offerEstimatedTotalAmount = getEstimatedTotalAmount(offerOrder || { total_amount: 0 });

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 sm:max-w-md sm:mx-auto shadow-2xl relative overflow-y-auto overflow-x-hidden pb-28">
      {/* Header */}
      <div className="bg-white px-5 pt-3 pb-3 shadow-sm z-10 sticky top-0 border-b border-slate-100">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h1 className="text-2xl font-black text-[#2DB0E6] tracking-tight">
              Р”Р°СЂРјР°РІРѕР·
            </h1>
            <p className="text-sm font-medium text-slate-500">
              РџР°РЅРµР»СЊ РІРѕРґРёС‚РµР»СЏ
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
            РђРєС‚РёРІРЅС‹Рµ Р·Р°РєР°Р·С‹
          </h2>

          {isProfileLoading ? (
            <div className="flex flex-col items-center justify-center p-10 text-slate-400 min-h-[50vh]">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#2DB0E6]" />
              <p className="text-sm font-medium">Р—Р°РіСЂСѓР·РєР° РїСЂРѕС„РёР»СЏ...</p>
            </div>
          ) : !isDriverActive || moderationStatus === "rejected" ? (
            <div className="flex flex-col items-center justify-center p-10 text-red-600 text-center mt-10 min-h-[50vh] bg-red-50 rounded-3xl border border-red-200 shadow-sm">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                <Ban className="w-10 h-10 text-red-500" />
              </div>
              <p className="text-xl font-bold text-red-700 mb-2 leading-tight">
                РџСЂРѕС„РёР»СЊ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ
              </p>
              <p className="text-sm text-red-600">
                Р’Р°С€ РїСЂРѕС„РёР»СЊ Р±С‹Р» РѕС‚РєР»РѕРЅРµРЅ РёР»Рё Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРј.
              </p>
            </div>
          ) : moderationStatus === "pending_moderation" ? (
            <div className="flex flex-col items-center justify-center p-10 text-amber-600 text-center mt-10 min-h-[50vh] bg-amber-50 rounded-3xl border border-amber-200 shadow-sm">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                <Clock className="w-10 h-10 text-amber-400" />
              </div>
              <p className="text-xl font-bold text-amber-700 mb-2 leading-tight">
                РџСЂРѕС„РёР»СЊ РЅР° РїСЂРѕРІРµСЂРєРµ. Р’С‹ РЅРµ РјРѕР¶РµС‚Рµ РїСЂРёРЅРёРјР°С‚СЊ Р·Р°РєР°Р·С‹.
              </p>
              <p className="text-sm text-amber-600">
                Р”РёСЃРїРµС‚С‡РµСЂ РїСЂРѕРІРµСЂСЏРµС‚ РІР°С€Рё РґР°РЅРЅС‹Рµ. РћР±С‹С‡РЅРѕ СЌС‚Рѕ Р·Р°РЅРёРјР°РµС‚ РЅРµ Р±РѕР»СЊС€Рµ
                С‡Р°СЃР°.
              </p>
            </div>
          ) : moderationStatus !== "approved" ? (
            <div className="flex flex-col items-center justify-center p-10 text-slate-500 text-center mt-10 min-h-[50vh] bg-slate-100 rounded-3xl border border-slate-200 shadow-sm">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                <AlertCircle className="w-10 h-10 text-slate-400" />
              </div>
              <p className="text-xl font-bold text-slate-700 mb-2">
                РўСЂРµР±СѓРµС‚СЃСЏ РґРµР№СЃС‚РІРёРµ
              </p>
              <p className="text-sm text-slate-500 mb-6">
                Р—Р°РІРµСЂС€РёС‚Рµ СЂРµРіРёСЃС‚СЂР°С†РёСЋ. Р—Р°РїРѕР»РЅРёС‚Рµ РґР°РЅРЅС‹Рµ РѕР± Р°РІС‚РѕРјРѕР±РёР»Рµ Рё
                Р·Р°РіСЂСѓР·РёС‚Рµ 3 С„РѕС‚РѕРіСЂР°С„РёРё СЃ СЂР°Р·РЅС‹С… СЃС‚РѕСЂРѕРЅ РІ СЂР°Р·РґРµР»Рµ В«РџСЂРѕС„РёР»СЊВ»,
                С‡С‚РѕР±С‹ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ РЅР° РјРѕРґРµСЂР°С†РёСЋ.
              </p>
              <button
                onClick={() => setActiveTab("profile")}
                className="bg-[#2DB0E6] text-white px-6 py-3 rounded-xl font-bold hover:bg-[#209BD6] transition-colors"
              >
                РџРµСЂРµР№С‚Рё РІ РџСЂРѕС„РёР»СЊ
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center p-10 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#2DB0E6]" />
              <p className="text-sm font-medium">Р—Р°РіСЂСѓР·РєР° Р·Р°РєР°Р·РѕРІ...</p>
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
                  РќРµС‚ Р°РєС‚РёРІРЅС‹С… Р·Р°РєР°Р·РѕРІ
                </p>
                <p className="text-sm">
                  РљРѕРіРґР° РїРѕСЏРІРёС‚СЃСЏ РЅРѕРІР°СЏ Р·Р°СЏРІРєР°, РѕРЅР° РѕС‚РѕР±СЂР°Р·РёС‚СЃСЏ Р·РґРµСЃСЊ.
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
            <span className="text-[10px] font-bold">Р—Р°РєР°Р·С‹</span>
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
            <span className="text-[10px] font-bold">РџСЂРѕС„РёР»СЊ</span>
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
                  РќРѕРІС‹Р№ Р·Р°РєР°Р·!
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
                    РљР°СЂСЊРµСЂ
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
                    РђРґСЂРµСЃ РґРѕСЃС‚Р°РІРєРё
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
                      РњР°С‚РµСЂРёР°Р»
                    </p>
                    <p className="text-sm font-bold text-slate-700">
                      {materialName}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                      РљСѓР±Р°С‚СѓСЂР°
                    </p>
                    <p className="text-sm font-bold text-slate-700">
                      {capacity} РјВі
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>РЎСѓРјРјР° Р·Р°РєР°Р·Р°</span>
                    <span className="text-slate-800">
                      {formatCurrency(offerOrder?.total_amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>Р”РѕСЃС‚Р°РІРєР°</span>
                    <span className="text-slate-800">
                      {formatCurrency(offerDeliveryCost)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-bold text-slate-700">
                    <span>РС‚РѕРіРѕ</span>
                    <span className="text-[#2DB0E6]">
                      {formatCurrency(offerEstimatedTotalAmount)}
                    </span>
                  </div>
                </div>

                {(currentOffer.order?.notes || currentOffer.notes) && (
                  <div className="mt-0.5 bg-amber-50 p-2.5 rounded-lg border border-amber-100">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-0.5 flex items-center gap-1.5">
                      <MessageSquare className="w-3 h-3" />
                      РљРѕРјРјРµРЅС‚Р°СЂРёР№
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
                РџР РРќРЇРўР¬ Р—РђРљРђР—
              </button>
              <button
                onClick={() =>
                  handleDeclineOffer(currentOffer.offer_id || currentOffer.id)
                }
                className="w-full bg-rose-50 text-rose-600 font-bold text-base h-12 rounded-xl hover:bg-rose-100 active:scale-[0.98] transition-all"
              >
                РћРўРљРђР—РђРўР¬РЎРЇ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CANCEL_REASONS = [
  "РЎР»РѕРјР°Р»Р°СЃСЊ РјР°С€РёРЅР°",
  "РќРµ СѓСЃРїРµРІР°СЋ РїРѕ РІСЂРµРјРµРЅРё",
  "РџСЂРѕРєРѕР» РєРѕР»РµСЃР° / Р”РўРџ",
  "РќРµ СѓСЃС‚СЂР°РёРІР°РµС‚ РјР°СЂС€СЂСѓС‚",
  "Р”СЂСѓРіРѕРµ",
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
    order.material_name || order.items?.[0]?.material?.name || "РќРµРёР·РІРµСЃС‚РЅРѕ";
  const capacity =
    order.capacity_m3 || order.delivery_option?.capacity_m3 || "?";
  const deliveryCost = getDeliveryCost(order);
  const estimatedTotalAmount = getEstimatedTotalAmount(order);
  const materialCost = estimatedTotalAmount - deliveryCost;
  const clientPhone = order.client_phone || order.client?.phone;
  const clientName = order.client_name || order.client?.name || order.client?.full_name || "РРјСЏ РЅРµ СѓРєР°Р·Р°РЅРѕ";
  const quarryName = order.quarry_name || order.quarry?.name || (order.pickup_address && !order.pickup_address.includes('57.') ? order.pickup_address : 'РўРѕС‡РєР° РїРѕРіСЂСѓР·РєРё');

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
        useAuthStore.getState().logout();
        return;
      }
      if (res.status === 403) {
        toast.error("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ (403)");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          extractApiErrorMessage(err, "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЃС‚Р°С‚СѓСЃ"),
        );
      }
      toast.success(step === "completed" ? "Р—Р°РєР°Р· СѓСЃРїРµС€РЅРѕ Р·Р°РІРµСЂС€РµРЅ! Р’С‹ СЃРЅРѕРІР° СЃРІРѕР±РѕРґРЅС‹." : "РЎС‚Р°С‚СѓСЃ РѕР±РЅРѕРІР»РµРЅ");
      onRefresh();
    } catch (e: any) {
      toast.error(handleApiError(e, "РћС€РёР±РєР° РїСЂРё РѕР±РЅРѕРІР»РµРЅРёРё СЃС‚Р°С‚СѓСЃР°"));
    } finally {
      setIsUpdating(false);
    }
  };

  const openNavigator = () => {
    const isToClient = order.status === "heading_to_client";
    const lat = isToClient ? order.delivery_lat : order.pickup_lat;
    const lon = isToClient ? order.delivery_lon : order.pickup_lon;
    const label = isToClient ? "\u041a\u043b\u0438\u0435\u043d\u0442" : "\u041a\u0430\u0440\u044c\u0435\u0440";

    if (!lat || !lon) {
      toast.error("\u041a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u044e\u0442");
      return;
    }

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(label)})`;
      return;
    }

    window.open(`https://2gis.ru/routeSearch/rsType/car/to/${lon},${lat}`, "_blank");
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
            РђРґСЂРµСЃ РґРѕСЃС‚Р°РІРєРё
          </p>
          <p className="text-sm font-bold text-slate-800 leading-snug">
            {order.address}
          </p>
        </div>
        <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-1">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
            РЎСѓРјРјР° Р·Р°РєР°Р·Р°
          </span>
          <span className="text-emerald-500 font-black text-base">
            {formatCurrency(order.total_amount)}
          </span>
        </div>
        <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
            Р”РѕСЃС‚Р°РІРєР°
          </span>
          <span className="text-slate-800 font-black text-base">
            {formatCurrency(deliveryCost)}
          </span>
        </div>
        <div className="flex justify-between items-center bg-blue-50 p-2.5 rounded-xl border border-blue-100">
          <span className="text-[11px] text-blue-500 font-bold uppercase tracking-wider">
            РС‚РѕРіРѕ
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
      selectedReason === "Р”СЂСѓРіРѕРµ" ? customReason : selectedReason;
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
        useAuthStore.getState().logout();
        return;
      }
      if (res.status === 403) {
        toast.error("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ (403)");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractApiErrorMessage(err, "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ Р·Р°РєР°Р·"));
      }
      toast.success("Р—Р°РєР°Р· РѕС‚РјРµРЅРµРЅ");
      setIsCancelModalOpen(false);
      setSelectedReason("");
      setCustomReason("");
      onRefresh(); // This clears the order state and loads the empty state
    } catch (e: any) {
      toast.error(handleApiError(e, "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ Р·Р°РєР°Р·"));
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
                РћС‚РєСѓРґР° (РљР°СЂСЊРµСЂ)
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
                РљСѓРґР° (РљР»РёРµРЅС‚)
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
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">РњР°С‚РµСЂРёР°Р»</span>
            <span className="text-sm font-bold text-slate-800">{materialName}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">РћР±СЉРµРј</span>
            <span className="text-sm font-bold text-slate-800">{capacity} РјВі</span>
          </div>
        </div>

        {/* Client Info */}
        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl mt-2">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">РљР»РёРµРЅС‚</span>
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
             <span className="font-bold uppercase tracking-wider text-[10px] block mb-1">РљРѕРјРјРµРЅС‚Р°СЂРёР№:</span>
             {order.notes}
          </div>
        )}

        {/* Total Amount */}
        <div className="flex flex-col items-end mt-4 pb-4 border-b border-gray-100 space-y-1">
          <span className="text-sm text-gray-500 font-medium">
            РњР°С‚РµСЂРёР°Р»: {formatCurrency(materialCost)}
          </span>
          <span className="text-sm text-gray-500 font-medium">
            Р”РѕСЃС‚Р°РІРєР°: {formatCurrency(deliveryCost)}
          </span>
          <span className="text-2xl font-bold text-[#2DB0E6] mt-2">
            РС‚РѕРіРѕ: {formatCurrency(estimatedTotalAmount)}
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
                    "Р’С‹РµС…Р°С‚СЊ РЅР° РєР°СЂСЊРµСЂ"
                  )}
                </button>
                <button
                  onClick={() => setIsCancelModalOpen(true)}
                  className="w-full py-4 text-red-500 font-medium text-base active:bg-red-50 rounded-xl transition-colors"
                >
                  РћС‚РєР°Р·Р°С‚СЊСЃСЏ РѕС‚ РІС‹РїРѕР»РЅРµРЅРёСЏ
                </button>
              </>
            )}

            {order.status === "heading_to_pickup" && (
              <>
                <button
                  onClick={() => updateStatus("heading_to_pickup")}
                  className="w-full h-14 bg-gradient-to-r from-emerald-700 to-emerald-500 active:from-emerald-800 active:to-emerald-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  РћС‚РєСЂС‹С‚СЊ РЅР°РІРёРіР°С‚РѕСЂ
                </button>
                <button
                  disabled={isUpdating}
                  onClick={() => updateStatus("arrived_at_pickup")}
                  className="w-full h-14 bg-sky-500 active:bg-sky-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isUpdating ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "РџСЂРёР±С‹Р» РЅР° РєР°СЂСЊРµСЂ"
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
                    "Р—Р°РіСЂСѓР·РёР»СЃСЏ, РµРґСѓ Рє РєР»РёРµРЅС‚Сѓ"
                  )}
                </button>
              </>
            )}

            {order.status === "heading_to_client" && (
              <>
                <button
                  onClick={openNavigator}
                  className="w-full h-14 bg-gradient-to-r from-emerald-700 to-emerald-500 active:from-emerald-800 active:to-emerald-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  РћС‚РєСЂС‹С‚СЊ РЅР°РІРёРіР°С‚РѕСЂ
                </button>
                <button
                  disabled={isUpdating}
                  onClick={() => updateStatus("completed")}
                  className="w-full h-14 bg-sky-500 active:bg-sky-600 text-white text-lg font-bold rounded-xl shadow-md transition-transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isUpdating ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Р—Р°РІРµСЂС€РёС‚СЊ Р·Р°РєР°Р·"
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
              РЈРєР°Р¶РёС‚Рµ РїСЂРёС‡РёРЅСѓ РѕС‚РєР°Р·Р°
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

            {selectedReason === "Р”СЂСѓРіРѕРµ" && (
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="РћРїРёС€РёС‚Рµ РїСЂРёС‡РёРЅСѓ РѕС‚РєР°Р·Р°..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 min-h-[100px] resize-none"
              />
            )}

            <div className="flex flex-col gap-2 mt-2">
              <button
                onClick={handleCancelOrder}
                disabled={
                  isCancelling ||
                  !selectedReason ||
                  (selectedReason === "Р”СЂСѓРіРѕРµ" && !customReason.trim())
                }
                className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-sm transition-all flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
                РџРѕРґС‚РІРµСЂРґРёС‚СЊ РѕС‚РєР°Р·
              </button>
              <button
                onClick={() => setIsCancelModalOpen(false)}
                disabled={isCancelling}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 px-4 rounded-xl transition-all"
              >
                РћС‚РјРµРЅР°
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
