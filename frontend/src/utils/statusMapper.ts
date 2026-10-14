import type { ClientOrderPaymentState, ClientOrderSummary } from "../store";

export const ORDER_STATUSES_RU: Record<string, string> = {
  draft: "Черновик",
  created: "Заказ создан",
  searching_driver: "Поиск водителя",
  offered_to_driver: "Поиск водителя",
  no_driver_found: "Водитель не найден",
  requires_clarification: "Требует уточнения",
  driver_assigned: "Водитель назначен",
  driver_accepted: "Водитель подтвердил заказ",
  heading_to_pickup: "Выехал на загрузку",
  arrived_at_pickup: "Прибыл на загрузку",
  loading: "Загрузка",
  heading_to_client: "Едет к клиенту",
  delivered: "Доставил",
  completed: "Завершён",
  cancelled: "Отменён",
  cancelled_by_client: "Отменён",
  cancelled_by_operator: "Отменён",
  canceled: "Отменён",
  timeout: "Таймаут (нет ответа)",
  driver_cancel: "Отказ водителя",
};

export const ORDER_TRACKER_PROGRESS: Record<string, { percentage: number; text: string }> = {
  new: { percentage: 10, text: "Заказ оформлен" },
  created: { percentage: 10, text: "Заказ оформлен" },
  searching_driver: { percentage: 20, text: "Ищем водителя..." },
  offered_to_driver: { percentage: 20, text: "Ищем водителя..." },
  no_driver_found: { percentage: 20, text: "Ищем водителя..." },
  timeout: { percentage: 20, text: "Ищем водителя..." },
  driver_assigned: { percentage: 40, text: "Водитель назначен" },
  driver_accepted: { percentage: 40, text: "Водитель назначен" },
  heading_to_pickup: { percentage: 60, text: "Машина едет на погрузку" },
  arrived_at_pickup: { percentage: 60, text: "Машина прибыла на погрузку" },
  loading: { percentage: 60, text: "Идет погрузка материала" },
  heading_to_client: { percentage: 80, text: "Машина едет к вам" },
  delivered: { percentage: 100, text: "Заказ получен" },
  completed: { percentage: 100, text: "Заказ получен" },
};

const STEP_INDEX_BY_STATUS: Record<string, number> = {
  created: 0,
  searching_driver: 1,
  offered_to_driver: 1,
  no_driver_found: 1,
  timeout: 1,
  driver_assigned: 2,
  driver_accepted: 2,
  heading_to_pickup: 3,
  arrived_at_pickup: 3,
  loading: 3,
  heading_to_client: 4,
  delivered: 5,
  completed: 5,
};

export const getOrderStatusText = (status: string | undefined | null) => {
  if (!status) return "Неизвестно";
  return ORDER_STATUSES_RU[status.toLowerCase()] || "Статус обновляется";
};

export const getClientOrderStatusText = (status: string | undefined | null) => {
  const normalizedStatus = status?.toLowerCase();
  if (normalizedStatus === "heading_to_client") return "Едет к вам";
  if (normalizedStatus === "awaiting_logist_review") return "Заказ оформлен";
  if (normalizedStatus === "waiting_for_payment") return "Ожидает оплаты";
  if (normalizedStatus === "no_driver_found" || normalizedStatus === "timeout") {
    return ORDER_STATUSES_RU.searching_driver;
  }
  return getOrderStatusText(normalizedStatus);
};

export const getOrderTrackerProgress = (status: string | undefined | null) => {
  if (!status) return null;
  return ORDER_TRACKER_PROGRESS[status.toLowerCase()] ?? null;
};

export const getOrderStepIndex = (status: string | undefined | null) => {
  if (!status) return -1;
  return STEP_INDEX_BY_STATUS[status] ?? -1;
};

// Payment availability comes from the authorized payments endpoint, not logistics.
export const toClientOrderPaymentState = (data: {
  can_pay?: boolean;
  quote?: unknown;
  items?: { status: string }[];
}): ClientOrderPaymentState => ({
  canPay: data.can_pay === true,
  quoteConfirmed: Boolean(data.quote),
  status: data.items?.some((payment) => payment.status === "succeeded")
    ? "succeeded"
    : data.items?.[0]?.status ?? (data.quote ? "waiting_for_payment" : null),
});

export const getClientOrderDisplayStatus = (
  order: Pick<ClientOrderSummary, "status" | "payment_status">,
  payment?: ClientOrderPaymentState,
) => {
  const status = order.status.toLowerCase();
  const closed = ["completed", "delivered", "cancelled", "canceled",
    "cancelled_by_client", "cancelled_by_operator"].includes(status);
  const paymentStatus = payment?.status ?? order.payment_status?.toLowerCase();
  const paid = ["succeeded", "refunded"].includes(order.payment_status?.toLowerCase() ?? "");
  // Dispatch may start at checkout; a confirmed quote/payment proves review.
  const awaitingDriver = ["new", "created", "searching_driver", "offered_to_driver",
    "no_driver_found", "timeout"].includes(status);
  if (awaitingDriver && !paid && !payment?.quoteConfirmed && !paymentStatus) {
    return "awaiting_logist_review";
  }
  return !closed && !paid && payment?.canPay &&
    ["pending", "waiting_for_payment"].includes(paymentStatus ?? "")
    ? "waiting_for_payment" : status;
};

export const getClientOrderTrackerProgress = (
  order: ClientOrderSummary,
  payment?: ClientOrderPaymentState,
) => {
  const displayStatus = getClientOrderDisplayStatus(order, payment);
  if (displayStatus === "awaiting_logist_review") {
    return { percentage: 10, text: "Заказ оформлен", description: "Ожидает проверки логистом" };
  }
  const progress = getOrderTrackerProgress(order.status);
  return progress ? {
    ...progress,
    text: displayStatus === "waiting_for_payment" ? "Ожидает оплаты" : progress.text,
    description: undefined,
  } : null;
};
