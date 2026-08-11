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
