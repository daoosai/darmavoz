import { useEffect, useState } from "react";
import PullToRefresh from "react-simple-pull-to-refresh";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Info, List, MapPin, Package, Truck, X } from "lucide-react";

import { baseURL, clientOrderStatusColors, resolveMediaUrl } from "./utils";
import { getOrderStatusText } from "./utils/statusMapper";
import {
  ClientOrderSummary,
  normalizeClientOrderSummary,
  useAuthStore,
  useClientOrdersStore,
} from "./store";

type ClientOrder = ClientOrderSummary;

const activeStatuses = new Set([
  "created",
  "requires_clarification",
  "searching_driver",
  "offered_to_driver",
  "no_driver_found",
  "driver_assigned",
  "driver_accepted",
  "heading_to_pickup",
  "arrived_at_pickup",
  "loading",
  "heading_to_client",
  "delivered",
]);

const clientCancellationReasons = [
  "Изменились планы",
  "Нашёл дешевле",
  "Долгая доставка",
  "Другое",
] as const;

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "Дата не указана";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatAmount = (order: ClientOrder) => {
  const amount =
    typeof order.total_price === "number"
      ? order.total_price
      : typeof order.estimated_total_amount === "number"
        ? order.estimated_total_amount
        : typeof order.total_amount === "number"
          ? order.total_amount
          : null;

  return amount == null ? "По расчету" : `${Number(amount).toLocaleString("ru-RU")} ₽`;
};

const getOrderMaterialTitle = (order: ClientOrder) =>
  order.items?.[0]?.material?.name || "Материал не указан";

const getOrderQuantity = (order: ClientOrder) => order.items?.[0]?.quantity || 1;

const getOrderMaterialImage = (order: ClientOrder) => {
  const material = order.items?.[0]?.material;
  const imageUrl =
    material?.primary_image_url ||
    material?.media_files?.find((file) => file.is_primary)?.public_url ||
    material?.media_files?.[0]?.public_url ||
    material?.image_url;

  return resolveMediaUrl(imageUrl);
};

function OrderCard({
  order,
  onCancel,
  onReply,
}: {
  order: ClientOrder;
  onCancel?: (order: ClientOrder) => void;
  onReply?: (order: ClientOrder) => void;
}) {
  const status = order.status.toLowerCase();
  const materialImage = getOrderMaterialImage(order);
  const clarificationQuestion =
    order.clarification_comment?.trim() ||
    order.clarification_reasons?.filter(Boolean).join(", ") ||
    "Логист ожидает уточнения по заказу.";
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Заказ #{order.id.slice(-6).toUpperCase()}
        </p>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-bold ${
            clientOrderStatusColors[status] || "border border-slate-200 bg-slate-100 text-slate-600"
          }`}
        >
          {getOrderStatusText(status)}
        </span>
      </div>

      <h3 className="mt-3 text-xl font-bold leading-snug text-slate-900">{getOrderMaterialTitle(order)}</h3>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-500">
        <Truck className="h-4 w-4 shrink-0 text-sky-500" />
        {getOrderQuantity(order)} шт. · {order.delivery_option?.title || "Самосвал"}
      </p>

      <div className="mt-4 overflow-hidden rounded-xl bg-sky-50">
        {materialImage ? (
          <img src={materialImage} alt={getOrderMaterialTitle(order)} className="h-48 w-full object-cover" />
        ) : (
          <div className="flex h-48 w-full items-center justify-center text-sky-300">
            <Package className="h-12 w-12" />
          </div>
        )}
      </div>

      <div className="mt-4">
        <p className="text-xs text-slate-400">Сумма</p>
        <p className="mt-1 text-xl font-bold text-slate-900">{formatAmount(order)}</p>
      </div>

      {status === "requires_clarification" ? (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">Вопрос от логиста</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">{clarificationQuestion}</p>
          {order.client_clarification_reply ? (
            <p className="mt-3 rounded-xl bg-white/70 p-3 text-sm text-amber-900">
              <span className="font-bold">Ваш ответ:</span> {order.client_clarification_reply}
            </p>
          ) : null}
          {onReply ? (
            <button
              type="button"
              onClick={() => onReply(order)}
              className="mt-3 w-full rounded-xl bg-sky-500 py-3 text-sm font-bold text-white transition hover:bg-sky-600"
            >
              Ответить на уточнение
            </button>
          ) : null}
        </section>
      ) : null}

      {order.driver ? (
        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Водитель</p>
          <p className="mt-1 font-bold text-slate-900">{order.driver.name}</p>
          <p className="text-sm text-slate-500">
            {order.driver.vehicle?.brand || order.driver.vehicle?.title || "Транспорт назначен"}
          </p>
        </div>
      ) : null}

      {order.address ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-slate-600">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          {order.address}
        </p>
      ) : null}
      <p className="mt-4 text-xs text-slate-400">Создан: {formatDateTime(order.created_at)}</p>
      {onCancel && new Set(["draft", "created", "requires_clarification", "searching_driver", "offered_to_driver", "driver_assigned", "no_driver_found", "timeout"]).has(order.status) ? <button type="button" onClick={() => onCancel(order)} className="mt-4 w-full rounded-xl border border-red-200 py-3 text-sm font-bold text-red-600">Отменить заказ</button> : null}
    </motion.article>
  );
}

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
  const { orders, isLoading, setOrders, setIsLoading, clearOrders } = useClientOrdersStore();
  const [activeTab, setActiveTab] = useState<"current" | "history">("current");
  const [cancelling, setCancelling] = useState<ClientOrder | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelComment, setCancelComment] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [replyingOrder, setReplyingOrder] = useState<ClientOrder | null>(null);
  const [clarificationReply, setClarificationReply] = useState("");
  const [clarificationReplyError, setClarificationReplyError] = useState("");
  const [isClarificationReplySaving, setIsClarificationReplySaving] = useState(false);

  const fetchOrders = async () => {
    if (role !== "client") {
      setOrders([]);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${baseURL}/clients/me/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setOrders(Array.isArray(data) ? data.map(normalizeClientOrderSummary) : []);
      } else {
        setOrders([]);
      }
    } catch {
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (role !== "client") {
      clearOrders();
      return;
    }

    if (orders.length === 0) {
      void fetchOrders();
    }
  }, [clearOrders, orders.length, role, token]);

  useEffect(() => {
    if (focusedOrderId) {
      setActiveTab("current");
    }
  }, [focusedOrderId]);

  const handleRefresh = async () => {
    await fetchOrders();
  };
  const openCancelModal = (order: ClientOrder) => {
    setCancelling(order);
    setCancelReason("");
    setCancelComment("");
    setCancelError("");
  };

  const closeCancelModal = (force = false) => {
    if (isCancelling && !force) return;
    setCancelling(null);
    setCancelReason("");
    setCancelComment("");
    setCancelError("");
  };

  const openClarificationReplyModal = (order: ClientOrder) => {
    setReplyingOrder(order);
    setClarificationReply(order.client_clarification_reply || "");
    setClarificationReplyError("");
  };

  const closeClarificationReplyModal = (force = false) => {
    if (isClarificationReplySaving && !force) return;
    setReplyingOrder(null);
    setClarificationReply("");
    setClarificationReplyError("");
  };

  const cancelOrder = async () => {
    if (!cancelling) return;
    const comment = cancelComment.trim();
    const reason = cancelReason === "Другое" ? comment : comment ? `${cancelReason}: ${comment}` : cancelReason;
    if (!reason) {
      setCancelError("Выберите или укажите причину отмены.");
      return;
    }

    try {
      setIsCancelling(true);
      const response = await fetch(`${baseURL}/clients/me/orders/${cancelling.id}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Не удалось отменить заказ");
      }
      setOrders(orders.filter((order) => order.id !== cancelling.id));
      closeCancelModal(true);
      await fetchOrders();
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "Не удалось отменить заказ");
    } finally {
      setIsCancelling(false);
    }
  };

  const replyToClarification = async () => {
    if (!replyingOrder) return;
    const reply = clarificationReply.trim();
    if (!reply) {
      setClarificationReplyError("Введите ответ для логиста.");
      return;
    }

    try {
      setIsClarificationReplySaving(true);
      setClarificationReplyError("");
      const response = await fetch(`${baseURL}/clients/me/orders/${replyingOrder.id}/clarify-reply`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reply }),
      });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.detail === "string" ? data.detail : "Не удалось отправить ответ.",
        );
      }
      const updatedOrder = data
        ? normalizeClientOrderSummary(data as ClientOrder)
        : { ...replyingOrder, client_clarification_reply: reply };
      setOrders(
        orders.map((order) => (order.id === replyingOrder.id ? updatedOrder : order)),
      );
      closeClarificationReplyModal(true);
      await fetchOrders();
    } catch (error) {
      setClarificationReplyError(
        error instanceof Error ? error.message : "Не удалось отправить ответ.",
      );
    } finally {
      setIsClarificationReplySaving(false);
    }
  };

  const currentOrders = focusedOrderId
    ? orders.filter((order) => order.id === focusedOrderId)
    : orders.filter((order) => activeStatuses.has(order.status));

  const historyOrders = orders
    .filter((order) => !activeStatuses.has(order.status))
    .sort(
      (first, second) =>
        new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
    );

  if (isLoading && orders.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 opacity-60">
        <List className="h-12 w-12 animate-pulse text-slate-300" />
        <span className="text-sm font-medium text-slate-500">Загрузка заказов...</span>
      </div>
    );
  }

  if (role !== "client") {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100">
          <Info className="h-8 w-8 text-slate-400" />
        </div>
        <h3 className="mb-2 text-[22px] font-bold text-slate-900">Вы не авторизованы</h3>
        <p className="mb-8 max-w-[280px] text-base text-slate-500">
          Войдите или зарегистрируйтесь, чтобы увидеть историю своих заказов
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="w-full max-w-[280px] rounded-2xl bg-[#2DB0E6] px-8 py-4 font-bold text-white shadow-md shadow-[#2DB0E6]/20 transition-all active:scale-95"
        >
          Вход / Регистрация
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-68px)] bg-gray-50">
      <div className="relative z-10 bg-gray-50 px-4 pb-2 pt-4">
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
          <div className="flex rounded-2xl bg-slate-200/50 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("current")}
              className={`flex-1 rounded-xl py-3 text-sm font-bold transition-all ${
                activeTab === "current"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Текущие
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`flex-1 rounded-xl py-3 text-sm font-bold transition-all ${
                activeTab === "history"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              История
            </button>
          </div>
        )}
      </div>

      <PullToRefresh
        onRefresh={handleRefresh}
        pullingContent=""
        refreshingContent={
          <div className="p-4 text-center text-sm text-slate-500">Обновление...</div>
        }
      >
        <div className="min-h-screen bg-gray-50 px-4 pb-24 pt-4">
          <AnimatePresence mode="wait">
            {activeTab === "current" ? (
              <motion.div
                key="current"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                {currentOrders.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    {currentOrders.map((order) => (
                      <div key={order.id}>
                        <OrderCard order={order} onCancel={openCancelModal} onReply={openClarificationReplyModal} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[40vh] flex-col items-center justify-center p-6 text-center opacity-60">
                    <Truck className="mb-4 h-12 w-12 text-slate-300" />
                    <p className="font-medium text-slate-500">Нет текущих заказов</p>
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
                {historyOrders.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {historyOrders.map((order) => (
                      <div key={order.id}>
                        <OrderCard order={order} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[40vh] flex-col items-center justify-center p-6 text-center opacity-60">
                    <Package className="mb-4 h-12 w-12 text-slate-300" />
                    <p className="font-medium text-slate-500">История заказов пуста</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </PullToRefresh>
      {cancelling ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="cancel-order-title">
          <div className="w-full rounded-3xl bg-white p-5 shadow-2xl sm:max-w-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="cancel-order-title" className="text-lg font-black text-slate-900">Отменить заказ?</h3>
                <p className="mt-1 text-sm text-slate-500">Поиск водителя будет остановлен.</p>
              </div>
              <button type="button" onClick={closeCancelModal} disabled={isCancelling} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-50" aria-label="Закрыть">
                <X className="h-4 w-4" />
              </button>
            </div>
            <fieldset className="mt-5 space-y-2">
              <legend className="text-sm font-bold text-slate-800">Причина отмены</legend>
              {clientCancellationReasons.map((item) => (
                <label key={item} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-semibold transition ${cancelReason === item ? "border-sky-400 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                  <input type="radio" name="cancel-reason" value={item} checked={cancelReason === item} onChange={() => { setCancelReason(item); setCancelError(""); }} className="accent-sky-500" />
                  {item}
                </label>
              ))}
            </fieldset>
            <label className="mt-4 block text-sm font-bold text-slate-800">
              {cancelReason === "Другое" ? "Укажите причину" : "Комментарий к отмене (необязательно)"}
              <textarea value={cancelComment} maxLength={cancelReason === "Другое" ? 500 : 470} onChange={(event) => { setCancelComment(event.target.value); setCancelError(""); }} placeholder={cancelReason === "Другое" ? "Расскажите, почему отменяете заказ" : "При необходимости добавьте детали"} className="mt-2 min-h-24 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm font-normal outline-none focus:border-sky-400" />
            </label>
            {cancelError ? <p className="mt-2 text-sm font-medium text-red-600">{cancelError}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={closeCancelModal} disabled={isCancelling} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700 disabled:opacity-50">Назад</button>
              <button type="button" onClick={() => void cancelOrder()} disabled={isCancelling} className="rounded-xl bg-red-500 py-3 font-bold text-white hover:bg-red-600 disabled:opacity-50">{isCancelling ? "Отменяем..." : "Отменить"}</button>
            </div>
          </div>
        </div>
      ) : null}
      {replyingOrder ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="clarification-reply-title">
          <form onSubmit={(event) => { event.preventDefault(); void replyToClarification(); }} className="w-full rounded-3xl bg-white p-5 shadow-2xl sm:max-w-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="clarification-reply-title" className="text-lg font-black text-slate-900">Ответить на уточнение</h3>
                <p className="mt-1 text-sm text-slate-500">Логист увидит ваш ответ и сможет продолжить работу с заказом.</p>
              </div>
              <button type="button" onClick={closeClarificationReplyModal} disabled={isClarificationReplySaving} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-50" aria-label="Закрыть">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mt-5 block text-sm font-bold text-slate-800">
              Ваш ответ
              <textarea
                required
                value={clarificationReply}
                maxLength={2000}
                onChange={(event) => { setClarificationReply(event.target.value); setClarificationReplyError(""); }}
                placeholder="Напишите уточнение для логиста"
                className="mt-2 min-h-28 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm font-normal outline-none focus:border-sky-400"
              />
            </label>
            {clarificationReplyError ? <p className="mt-2 text-sm font-medium text-red-600">{clarificationReplyError}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={closeClarificationReplyModal} disabled={isClarificationReplySaving} className="rounded-xl bg-slate-100 py-3 font-bold text-slate-700 disabled:opacity-50">Назад</button>
              <button disabled={isClarificationReplySaving} className="rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600 disabled:opacity-50">{isClarificationReplySaving ? "Отправляем..." : "Отправить"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
