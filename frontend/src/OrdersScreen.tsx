import React, { useState, useEffect, useRef } from "react";
import PullToRefresh from "react-simple-pull-to-refresh";
import { Package, MapPin, Calendar, Truck, List, Info, User as UserIcon, Phone, Search, UserCheck, CheckCircle, ChevronDown, ArrowLeft, Wrench, X } from "lucide-react";
import toast from "react-hot-toast";
import { clientOrderStatusColors, baseURL, extractApiErrorMessage, resolveMediaUrl } from "./utils";
import { getOrderStatusText, getOrderStepIndex } from "./utils/statusMapper";
import { ClientOrderSummary, normalizeClientOrderSummary, useAuthStore, useClientOrdersStore } from "./store";
import { motion, AnimatePresence } from "motion/react";

type ClientOrder = ClientOrderSummary;

interface EquipmentApplication {
  id: string;
  listing_id: string;
  listing_title_snapshot: string;
  object_address: string;
  requested_date: string;
  requested_time: string;
  duration_value: number;
  duration_unit: "hours" | "shifts";
  total_price?: number | null;
  status: "new" | "in_progress" | "closed" | "completed" | "rejected" | "cancelled";
  reject_reason?: string | null;
  cancel_reason?: string | null;
  primary_image_url?: string | null;
  created_at: string;
}

const equipmentStatusLabels: Record<EquipmentApplication["status"], string> = {
  new: "Новая",
  in_progress: "В работе",
  closed: "Завершена",
  completed: "Завершена",
  rejected: "Отклонена",
  cancelled: "Отменена",
};

const equipmentStatusClasses: Record<EquipmentApplication["status"], string> = {
  new: "bg-amber-100 text-amber-700",
  in_progress: "bg-sky-100 text-sky-700",
  closed: "bg-emerald-100 text-emerald-700",
  completed: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-rose-100 text-rose-700",
};

const activeStatuses = [
  "created", "searching_driver", "offered_to_driver", "no_driver_found",
  "driver_assigned", "driver_accepted",
  "heading_to_pickup", "arrived_at_pickup", "loading",
  "heading_to_client"
];

const formatDate = (dateString: string) => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
};

const formatEquipmentApplicationPrice = (value?: number | null) =>
  value == null ? "По договорённости" : `${Number(value).toLocaleString("ru-RU")} ₽`;

const getOrderDisplayAmount = (
  order: Pick<ClientOrder, "total_price" | "estimated_total_amount" | "total_amount" | "delivery_cost">,
) => {
  if (typeof order.total_price === "number") return order.total_price;
  if (typeof order.estimated_total_amount === "number") return order.estimated_total_amount;
  if (order.total_amount == null && order.delivery_cost == null) return null;
  return Number(order.total_amount ?? 0) + Number(order.delivery_cost ?? 0);
};

const formatOrderDisplayAmount = (
  order: Pick<ClientOrder, "total_price" | "estimated_total_amount" | "total_amount" | "delivery_cost">,
) => {
  const amount = getOrderDisplayAmount(order);
  return amount == null ? "..." : `${amount.toLocaleString("ru-RU")} ₽`;
};

const EquipmentApplicationProgress = ({ application }: { application: EquipmentApplication }) => {
  if (application.status === "rejected" || application.status === "cancelled") {
    return (
      <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-center text-sm font-bold text-rose-700">
        {application.status === "rejected" ? "Заявка отклонена" : "Заявка отменена"}
      </div>
    );
  }

  const steps = ["Новая", "В работе", "Завершена"];
  const currentStep = application.status === "new" ? 0 : application.status === "in_progress" ? 1 : 2;
  const progress = `${(currentStep / (steps.length - 1)) * 100}%`;

  return (
    <div className="mt-5 px-1">
      <div className="relative">
        <div className="absolute left-3 right-3 top-3 h-1 overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8_0%,#0ea5e9_45%,#7dd3fc_100%)] bg-[length:200%_100%]"
            style={{ width: progress }}
            animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
            transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
          />
        </div>
        <div className="relative flex justify-between">
          {steps.map((step, index) => (
            <div key={step} className="flex w-20 flex-col items-center text-center">
              <div
                className={`relative grid h-7 w-7 place-items-center rounded-full border-2 text-[10px] font-black transition-all ${
                  index <= currentStep
                    ? "border-sky-500 bg-sky-500 text-white"
                    : "border-slate-200 bg-white text-slate-400"
                } ${index === currentStep ? "shadow-lg shadow-sky-200 ring-4 ring-sky-100" : ""}`}
              >
                {index === currentStep ? (
                  <motion.span
                    className="absolute inset-[-4px] rounded-full bg-sky-200/70"
                    animate={{ scale: [1, 1.2, 1], opacity: [0.55, 0.15, 0.55] }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                  />
                ) : null}
                <span className="relative">{index + 1}</span>
              </div>
              <span
                className={`mt-2 text-[10px] font-bold ${
                  index <= currentStep ? "text-sky-700" : "text-slate-400"
                } ${index === currentStep ? "animate-pulse" : ""}`}
              >
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const EquipmentHistoryCard = ({ application }: { application: EquipmentApplication }) => {
  const statusLabel = application.status === "rejected"
    ? "Отклонён"
    : application.status === "cancelled"
      ? "Отменён"
      : "Завершён";
  return (
    <article className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Заявка #{application.id.slice(0, 8).toUpperCase()}</p><h3 className="mt-1 text-lg font-black text-slate-900">{application.listing_title_snapshot}</h3></div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-bold ${equipmentStatusClasses[application.status]}`}>{statusLabel}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3 text-sm"><div><p className="text-xs text-slate-400">Дата</p><p className="mt-1 font-bold text-slate-700">{formatDate(application.requested_date)}</p></div><div><p className="text-xs text-slate-400">Сумма</p><p className="mt-1 font-bold text-slate-700">{formatEquipmentApplicationPrice(application.total_price)}</p></div></div>
      <p className="mt-3 flex items-start gap-2 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{application.object_address}</p>
      {application.reject_reason && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><span className="font-bold">Причина отказа:</span> {application.reject_reason}</p>}
      {application.cancel_reason && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><span className="font-bold">Причина отмены:</span> {application.cancel_reason}</p>}
    </article>
  );
};

const ActiveOrderCard: React.FC<{ order: ClientOrder }> = ({ order }) => {
  const stepIndex = getOrderStepIndex(order.status);
  
  const renderCentralAnimation = () => {
    if (stepIndex === 1) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 py-4">
          <motion.div
            animate={{ scale: [1, 1.15, 1], rotate: [-5, 5, -5] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          >
            <Search className="w-12 h-12 text-[#2DB0E6]" />
          </motion.div>
          <span className="text-xs font-bold text-[#2DB0E6] uppercase tracking-widest text-center mt-1">Ищем водителя</span>
        </div>
      );
    } else if (stepIndex === 2 || stepIndex === 3 || stepIndex === 4) {
      const isAssigned = stepIndex === 2;
      const isToQuarry = stepIndex === 3;
      const nameParts = order.driver?.name?.split(' ') || [];
      const firstName = nameParts.length > 1 ? nameParts[1] : nameParts[0] || "Водитель";
      const vehicleBrand = order.driver?.vehicle?.brand || order.driver?.vehicle?.title || "Грузовик";
      const plateNumber = order.driver?.vehicle?.plate_number;

      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 py-4 px-2">
          <motion.div
            initial={isAssigned ? { scale: 0 } : undefined}
            animate={isAssigned ? { scale: 1 } : { x: [-20, 20, -20], y: [0, -3, 0] }}
            transition={isAssigned ? { type: "spring", bounce: 0.5 } : { repeat: Infinity, duration: 4, ease: "easeInOut" }}
          >
            {isAssigned ? <UserCheck className="w-10 h-10 text-[#2DB0E6]" /> : <Truck className="w-12 h-12 text-[#2DB0E6]" />}
          </motion.div>
          <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest text-center ${isAssigned ? "text-[#2DB0E6]" : "text-[#2DB0E6]"}`}>
            {isAssigned ? "Водитель назначен" : isToQuarry ? "Едет на погрузку" : "Машина едет к вам"}
          </span>
          {order.driver && (
            <div className="flex flex-col text-slate-700 bg-white/70 w-full rounded-xl border border-white mt-1 shadow-sm overflow-hidden text-left ring-1 ring-slate-100">
              <div className="flex items-center gap-3 p-2.5">
                <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                  <Truck className="w-4 h-4 text-slate-500" />
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="font-bold text-[14px] truncate text-slate-800">{firstName}</span>
                  <span className="font-medium text-[11px] sm:text-xs text-slate-500 truncate">{vehicleBrand}</span>
                </div>
              </div>
              {plateNumber && (
                <div className="px-2.5 pb-2.5 flex justify-start">
                  <div className="inline-flex items-center rounded bg-white border border-slate-300 shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden h-[24px]">
                    <span className="px-2 font-mono font-black text-slate-800 text-[12px] uppercase tracking-wider">{plateNumber}</span>
                    <div className="h-full border-l border-slate-300 bg-white px-1.5 flex flex-col items-center justify-center">
                       <span className="text-[7px] font-bold text-slate-800 leading-[7px] mb-[2px]">RUS</span>
                       <div className="flex flex-col border border-slate-200/50">
                          <div className="w-[10px] h-[2px] bg-white"></div>
                          <div className="w-[10px] h-[2px] bg-blue-700"></div>
                          <div className="w-[10px] h-[2px] bg-red-600"></div>
                       </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    } else if (stepIndex === 5) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 py-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.6, duration: 0.6 }}
          >
            <CheckCircle className="w-14 h-14 text-emerald-500" />
          </motion.div>
          <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest text-center mt-1">Заказ получен</span>
        </div>
      );
    } else {
      // created
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 py-4">
           <Package className="w-12 h-12 text-slate-400" />
           <span className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center mt-1">Оформлен</span>
        </div>
      );
    }
  };

  const steps = [
    { label: 'Оформлен' },
    { label: 'Поиск' },
    { label: 'Назначен' },
    { label: 'На погрузку' },
    { label: <>Машина едет<br/>к вам</> },
    { label: 'Получен' },
  ];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.3 } }}
      className="bg-white rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/80 flex flex-col gap-4 relative overflow-hidden ring-1 ring-slate-900/5"
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />

      {/* Header info */}
      <div className="flex justify-between items-start border-b border-slate-50 pb-4 relative z-10">
        <div className="flex flex-col gap-1 pr-2">
          <span className="font-bold text-slate-900 text-lg leading-tight block">
            Заказ #{order.id.slice(-4).toUpperCase()}
          </span>
          <span className="text-sm font-semibold text-slate-500 block">
            {order.items?.[0]?.material?.name || "Без материала"} • {order.items?.[0]?.quantity || 1} шт.
          </span>
          {order.address && (
              <div className="flex items-start gap-1.5 mt-1.5 opacity-80">
                 <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#2DB0E6]" />
                 <span className="text-xs font-medium leading-snug line-clamp-2 text-slate-600">{order.address}</span>
              </div>
          )}
        </div>
        <div className="flex flex-col items-end shrink-0">
             <span className="font-black text-[#2DB0E6] text-xl">
                 {order.total_amount ? `${order.total_amount} ₽` : "..."}
             </span>
        </div>
      </div>

      <div className="flex gap-4 mt-2 relative z-10 w-full">
        {/* Vertical Timeline container */}
        <div className="flex flex-1 max-w-[140px] relative">
            <div className="flex flex-col justify-between items-center py-1.5 relative w-[22px] shrink-0">
              {/* Background track */}
              <div className="absolute top-[14px] bottom-[14px] left-1/2 w-[3px] bg-slate-100 -translate-x-1/2 rounded-full" />
              
              {/* Active track */}
              <div 
                className="absolute top-[14px] left-1/2 w-[3px] bg-[#2DB0E6] -translate-x-1/2 rounded-full transition-all duration-700 ease-in-out" 
                style={{ bottom: `${100 - (Math.max(0, stepIndex) / 5) * 100}%`, height: 'auto' }} 
              />

              {steps.map((step, idx) => {
                const isPassed = idx < stepIndex;
                const isCurrent = idx === stepIndex;
                return (
                  <div key={idx} className="relative z-10 flex flex-col items-center justify-center">
                    {isCurrent && (
                      <motion.div
                        className="absolute w-6 h-6 rounded-full bg-[#2DB0E6] opacity-20"
                        animate={{ scale: [1, 1.8, 1], opacity: [0.3, 0, 0.3] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      />
                    )}
                    <div 
                      className={`w-3.5 h-3.5 rounded-full border-[3px] transition-colors duration-500 shadow-sm ${
                        isPassed ? 'bg-[#2DB0E6] border-[#2DB0E6]' : isCurrent ? 'bg-white border-[#2DB0E6]' : 'bg-white border-slate-200'
                      }`} 
                    />
                  </div>
                );
              })}
            </div>

            {/* Labels for timeline */}
            <div className="flex flex-col justify-between py-1 shrink-0 pl-3">
                {steps.map((step, idx) => {
                    const isPassed = idx < stepIndex;
                    const isCurrent = idx === stepIndex;
                    return (
                        <div key={idx} className={`text-[11px] sm:text-xs uppercase tracking-wide font-bold min-h-[16px] leading-[1.1] flex items-center ${isPassed ? 'text-slate-600' : isCurrent ? 'text-[#2DB0E6]' : 'text-slate-400'}`}>
                            {step.label}
                        </div>
                    )
                })}
            </div>
        </div>

        {/* Central Animation Card */}
        <div className="flex-1 rounded-2xl bg-slate-50/70 border border-slate-100/80 flex items-center justify-center p-2 sm:p-3 overflow-hidden shadow-inner relative min-w-[120px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className="w-full h-full flex items-center justify-center"
            >
              {renderCentralAnimation()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

const HistoryOrderCard = ({ order }: { order: ClientOrder }) => {
  return (
    <div className="bg-white rounded-[20px] p-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] border border-slate-100 flex flex-col gap-3 hover:bg-slate-50 transition-colors">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
           <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100 shrink-0">
               <Package className="w-5 h-5 text-slate-400" />
           </div>
           <div className="flex flex-col gap-0.5">
              <span className="font-bold text-slate-800 text-[15px] leading-none pt-0.5 block">Заказ #{order.id.slice(-4).toUpperCase()}</span>
              <span className="text-[11px] font-semibold text-slate-400 block">{formatDate(order.created_at)}</span>
           </div>
        </div>
        <div className="flex flex-col items-end justify-center gap-1.5 shrink-0 pl-2">
             <span className="font-bold text-slate-700 text-base leading-none block">{order.total_amount ? `${order.total_amount} ₽` : "..."}</span>
             <span className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md leading-none ${
                clientOrderStatusColors[order.status] || 'bg-slate-100 text-slate-500 border border-slate-200/50'
             }`}>
                {getOrderStatusText(order.status) || order.status}
             </span>
        </div>
      </div>
      {(order.address || order.items?.[0]) && (
          <div className="flex flex-col gap-1.5 bg-slate-50/50 p-2.5 rounded-xl border border-slate-50 mt-1">
            {order.items?.[0] && (
               <div className="flex items-center gap-2">
                 <div className="w-1 h-3 bg-slate-300 rounded-full" />
                 <span className="text-xs font-semibold text-slate-600">
                    {order.items[0].material.name} • {order.items[0].quantity} шт
                 </span>
               </div>
            )}
            {order.address && (
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5 ml-0.5" />
                <span className="text-xs font-medium text-slate-500 line-clamp-2 leading-snug pr-2">{order.address}</span>
              </div>
            )}
          </div>
      )}
    </div>
  );
};

export default function OrdersScreen({
  onOpenAuth,
  focusedOrderId,
  onBackToOrders,
}: {
  onOpenAuth?: () => void;
  focusedOrderId?: string | null;
  onBackToOrders?: () => void;
}) {
  const { role, token } = useAuthStore();
  const {
    orders,
    isLoading,
    setOrders,
    setIsLoading,
    clearOrders,
  } = useClientOrdersStore();

  const [activeTab, setActiveTab] = useState<'current' | 'history' | 'equipment'>('current');
  const [equipmentApplications, setEquipmentApplications] = useState<EquipmentApplication[]>([]);
  const [equipmentApplicationsLoading, setEquipmentApplicationsLoading] = useState(true);
  const [cancellingApplication, setCancellingApplication] = useState<EquipmentApplication | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [recentlyCompletedIds, setRecentlyCompletedIds] = useState<string[]>([]);
  const prevOrdersRef = useRef<ClientOrder[]>([]);

  const fetchOrders = async () => {
    if (role !== "client") {
      setOrders([]);
      setIsLoading(false);
      return;
    }
    
    try {
      const res = await fetch(`${baseURL}/clients/me/orders`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setOrders(Array.isArray(data) ? data.map(normalizeClientOrderSummary) : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchEquipmentApplications = async (silent = false) => {
    if (role !== "client" || !token) {
      setEquipmentApplications([]);
      setEquipmentApplicationsLoading(false);
      return;
    }
    if (!silent) setEquipmentApplicationsLoading(true);
    try {
      const response = await fetch(`${baseURL}/client/equipment-applications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) setEquipmentApplications(await response.json());
    } catch (error) {
      console.error(error);
    } finally {
      if (!silent) setEquipmentApplicationsLoading(false);
    }
  };

  const cancelEquipmentApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!cancellingApplication || !cancelReason.trim() || !token) return;
    setCancelling(true);
    try {
      const response = await fetch(`${baseURL}/client/equipment-applications/${cancellingApplication.id}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_reason: cancelReason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось отменить заявку"));
      setEquipmentApplications((previous) => previous.map((item) => item.id === data.id ? data : item));
      setCancellingApplication(null);
      setCancelReason("");
      toast.success("Заявка отменена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отменить заявку");
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (role !== "client") {
      clearOrders();
      setEquipmentApplications([]);
      setEquipmentApplicationsLoading(false);
      return;
    }
    if (orders.length === 0) void fetchOrders();
    void fetchEquipmentApplications();
  }, [role, token]);

  useEffect(() => {
    if (role !== "client" || !token) return;
    const timer = window.setInterval(() => {
      void fetchEquipmentApplications(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [role, token]);

  useEffect(() => {
    if (focusedOrderId) setActiveTab("current");
  }, [focusedOrderId]);

  useEffect(() => {
    const prevOrders = prevOrdersRef.current;
    if (prevOrders.length > 0) {
      const newCompletions: string[] = [];
      orders.forEach(order => {
        const pOrder = prevOrders.find(p => p.id === order.id);
        if (pOrder && pOrder.status !== 'completed' && order.status === 'completed') {
          if (!recentlyCompletedIds.includes(order.id)) {
             newCompletions.push(order.id);
          }
        }
      });

      if (newCompletions.length > 0) {
        setRecentlyCompletedIds(prev => [...prev, ...newCompletions]);
        newCompletions.forEach(id => {
          setTimeout(() => {
            setRecentlyCompletedIds(prev => prev.filter(cId => cId !== id));
          }, 4000);
        });
      }
    }
    prevOrdersRef.current = orders;
  }, [orders, recentlyCompletedIds]);

  const handleRefresh = async () => {
    await Promise.all([fetchOrders(), fetchEquipmentApplications()]);
  };

  if (isLoading && orders.length === 0 && equipmentApplicationsLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full min-h-[50vh] gap-3 opacity-60">
        <List className="w-12 h-12 text-slate-300 animate-pulse" />
        <span className="text-slate-500 font-medium text-sm animate-pulse">
          Загрузка заказов...
        </span>
      </div>
    );
  }

  if (role !== "client") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center h-full min-h-[400px]">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-5">
          <Info className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-[22px] font-bold text-slate-900 mb-2">
          Вы не авторизованы
        </h3>
        <p className="text-base text-slate-500 mb-8 max-w-[280px]">
          Войдите или зарегистрируйтесь, чтобы увидеть историю своих заказов
        </p>
        <button
          onClick={onOpenAuth}
          className="bg-[#2DB0E6] text-white px-8 py-4 rounded-2xl font-bold shadow-md shadow-[#2DB0E6]/20 active:scale-95 transition-all w-full max-w-[280px]"
        >
          Вход / Регистрация
        </button>
      </div>
    );
  }

  const displayActiveOrders = focusedOrderId
    ? orders.filter((order) => order.id === focusedOrderId)
    : orders.filter(o => activeStatuses.includes(o.status) || recentlyCompletedIds.includes(o.id));
  const displayHistoryOrders = orders.filter(o => 
     !activeStatuses.includes(o.status) && !recentlyCompletedIds.includes(o.id)
  );
  const activeEquipmentApplications = equipmentApplications.filter(
    (application) => application.status === "new" || application.status === "in_progress",
  );
  const historyEquipmentApplications = equipmentApplications.filter(
    (application) => !["new", "in_progress"].includes(application.status),
  );

  return (
    <div className="min-h-[calc(100vh-68px)] bg-gray-50 flex flex-col">
      {/* Tabs / focused order navigation */}
      <div className="px-4 pt-4 pb-2 bg-gray-50 relative z-10">
        {focusedOrderId ? (
          <button
            type="button"
            onClick={onBackToOrders}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Все заказы
          </button>
        ) : (
        <div className="flex bg-slate-200/50 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab('current')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${
              activeTab === 'current'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Текущие
          </button>
          <button
            onClick={() => setActiveTab('equipment')}
            className={`flex-1 rounded-xl px-2 py-3 text-xs font-bold leading-tight transition-all ${
              activeTab === 'equipment'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <span className="relative inline-flex items-center justify-center">
              <span>Заявки на технику</span>
              {activeEquipmentApplications.length > 0 ? (
                <span className="absolute -right-4 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white shadow-sm">
                  {activeEquipmentApplications.length}
                </span>
              ) : null}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${
              activeTab === 'history'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            История
          </button>
        </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden relative">
        <PullToRefresh onRefresh={handleRefresh} pullingContent={""} refreshingContent={<div className="p-4 text-center text-slate-500 text-sm">Обновление...</div>}>
          <div className="min-h-screen bg-gray-50 px-4 pb-24 pt-4">
            <AnimatePresence mode="wait">
              {activeTab === 'equipment' ? (
                <motion.div
                  key="equipment"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                >
                  {equipmentApplicationsLoading ? (
                    <p className="py-16 text-center text-sm text-slate-400">Загрузка заявок...</p>
                  ) : activeEquipmentApplications.length > 0 ? (
                    <div className="flex flex-col gap-4">
                      {activeEquipmentApplications.map((application) => (
                        <article key={application.id} className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
                          <div className="flex gap-3">
                            {application.primary_image_url ? (
                              <img src={resolveMediaUrl(application.primary_image_url) || "/placeholder.jpg"} alt={application.listing_title_snapshot} className="h-20 w-24 shrink-0 rounded-xl bg-slate-100 object-contain" />
                            ) : (
                              <div className="grid h-20 w-24 shrink-0 place-items-center rounded-xl bg-slate-100"><Wrench className="h-7 w-7 text-slate-300" /></div>
                            )}
                            <div className="min-w-0 flex-1">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${equipmentStatusClasses[application.status]}`}>{equipmentStatusLabels[application.status]}</span>
                              <div className="mt-2 flex items-start justify-between gap-3">
                                <h3 className="min-w-0 flex-1 font-black text-slate-900">{application.listing_title_snapshot}</h3>
                                <span className="shrink-0 text-sm font-black text-slate-900">{formatEquipmentApplicationPrice(application.total_price)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 space-y-2 text-sm text-slate-600">
                            <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{application.object_address}</p>
                            <p className="flex items-center gap-2"><Calendar className="h-4 w-4 shrink-0 text-slate-400" />{formatDate(application.requested_date)}, {application.requested_time.slice(0, 5)} · {application.duration_value} {application.duration_unit === "hours" ? "ч." : "смен"}</p>
                          </div>
                          <EquipmentApplicationProgress application={application} />
                          {application.reject_reason && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><span className="font-bold">Причина отказа:</span> {application.reject_reason}</p>}
                          {application.cancel_reason && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><span className="font-bold">Причина отмены:</span> {application.cancel_reason}</p>}
                          {(application.status === "new" || application.status === "in_progress") && <button onClick={() => { setCancellingApplication(application); setCancelReason(""); }} className="mt-4 w-full rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 transition hover:bg-rose-100">Отменить заявку</button>}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-[40vh] flex-col items-center justify-center p-6 text-center opacity-60">
                      <Wrench className="mb-4 h-12 w-12 text-slate-300" />
                      <p className="font-medium text-slate-500">Заявок на технику пока нет</p>
                    </div>
                  )}
                </motion.div>
              ) : activeTab === 'current' ? (
                <motion.div
                  key="current"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  {displayActiveOrders.length > 0 ? (
                    <div className="flex flex-col gap-6">
                      <AnimatePresence>
                        {displayActiveOrders.map(order => (
                          <ActiveOrderCard key={order.id} order={order} />
                        ))}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-6 text-center min-h-[40vh] opacity-60">
                      <Package className="w-12 h-12 text-slate-300 mb-4" />
                      <p className="text-slate-500 font-medium">Нет текущих заказов</p>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                >
                  {displayHistoryOrders.length > 0 || historyEquipmentApplications.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      <AnimatePresence>
                          {displayHistoryOrders.map(order => (
                              <motion.div
                                  key={order.id}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  layout
                              >
                                  <HistoryOrderCard order={order} />
                              </motion.div>
                          ))}
                      </AnimatePresence>
                      {historyEquipmentApplications.map((application) => <div key={application.id}><EquipmentHistoryCard application={application} /></div>)}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-6 text-center min-h-[40vh] opacity-60">
                      <List className="w-12 h-12 text-slate-300 mb-4" />
                      <p className="text-slate-500 font-medium">История заказов пуста</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </PullToRefresh>
      </div>
      {cancellingApplication && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"><form onSubmit={cancelEquipmentApplication} className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"><div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold text-rose-600">ОТМЕНА ЗАЯВКИ</p><h3 className="text-xl font-black">{cancellingApplication.listing_title_snapshot}</h3></div><button type="button" onClick={() => setCancellingApplication(null)} className="rounded-full bg-slate-100 p-2"><X className="h-5 w-5" /></button></div><label className="block text-sm font-bold">Причина отмены<textarea autoFocus required rows={5} maxLength={5000} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="mt-2 w-full resize-none rounded-xl bg-slate-100 p-3 font-normal outline-none" /></label><div className="mt-5 flex gap-2"><button type="button" onClick={() => setCancellingApplication(null)} className="flex-1 rounded-xl bg-slate-100 p-3 font-bold text-slate-600">Назад</button><button disabled={cancelling || !cancelReason.trim()} className="flex-1 rounded-xl bg-rose-600 p-3 font-bold text-white disabled:opacity-50">{cancelling ? "Отменяем..." : "Отменить заявку"}</button></div></form></div>}
    </div>
  );
}

