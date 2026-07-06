export const ORDER_STATUSES_RU: Record<string, string> = {
  created: 'Создан',
  searching_driver: 'В поиске',
  offered_to_driver: 'Предложен водителю',
  driver_assigned: 'Назначен',
  driver_accepted: 'Принят',
  heading_to_pickup: 'Выехал',
  arrived_at_pickup: 'Прибыл на загрузку',
  loading: 'Загрузка',
  heading_to_client: 'Едет к клиенту',
  delivered: 'Доставил',
  completed: 'Завершен',
  cancelled: 'Отменен',
  canceled: 'Отменен',
  timeout: 'Таймаут',
  no_driver_found: 'Нет исполнителя',
  driver_cancel: 'Отказ водителя',
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
  created: 'bg-gray-200 text-gray-700 border border-gray-300',
  pending: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  searching_driver: 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse',
  offered_to_driver: 'bg-sky-100 text-sky-800 border border-sky-200',
  no_driver_found: 'bg-red-100 text-red-800 border border-red-200',
  timeout: 'bg-red-100 text-red-800 border border-red-200',
  driver_assigned: 'bg-blue-100 text-blue-800 border border-blue-200',
  driver_accepted: 'bg-blue-100 text-blue-800 border border-blue-200',
  heading_to_pickup: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  arrived_at_pickup: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  loading: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  heading_to_client: 'bg-green-100 text-green-800 border border-green-200',
  delivered: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  completed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  cancelled: 'bg-red-100 text-red-800 border border-red-200',
  canceled: 'bg-red-100 text-red-800 border border-red-200',
  driver_cancel: 'bg-red-100 text-red-800 border border-red-200',
  default: 'bg-slate-100 text-slate-600 border border-slate-200',
};

export const CLIENT_ORDER_STATUS_COLORS: Record<string, string> = {
  created: 'bg-gray-100 text-gray-700 border border-gray-200',
  searching_driver: 'bg-gray-100 text-gray-600 border border-gray-200',
  offered_to_driver: 'bg-gray-100 text-gray-600 border border-gray-200',
  no_driver_found: 'bg-red-100 text-red-600 border border-red-200',
  timeout: 'bg-red-100 text-red-600 border border-red-200',
  driver_assigned: 'bg-blue-100 text-blue-600 border border-blue-200',
  driver_accepted: 'bg-blue-100 text-blue-600 border border-blue-200',
  heading_to_pickup: 'bg-indigo-100 text-indigo-600 border border-indigo-200',
  arrived_at_pickup: 'bg-indigo-100 text-indigo-600 border border-indigo-200',
  loading: 'bg-indigo-100 text-indigo-600 border border-indigo-200',
  heading_to_client: 'bg-emerald-100 text-emerald-600 border border-emerald-200',
  delivered: 'bg-green-100 text-green-700 border border-green-200',
  completed: 'bg-green-100 text-green-700 border border-green-200',
  cancelled: 'bg-red-100 text-red-600 border border-red-200',
  canceled: 'bg-red-100 text-red-600 border border-red-200',
};

export const CLIENT_TRACKER_ACTIVE_STATUSES = [
  'created',
  'searching_driver',
  'offered_to_driver',
  'no_driver_found',
  'timeout',
  'driver_assigned',
  'driver_accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'loading',
  'heading_to_client',
] as const;

export const getOrderStatusText = (status: string | undefined | null) => {
  if (!status) return 'Неизвестно';
  return ORDER_STATUSES_RU[status.toLowerCase()] || status;
};

export const getOrderStatusColor = (status: string | undefined | null) => {
  if (!status) return ORDER_STATUS_COLORS.default;
  return ORDER_STATUS_COLORS[status.toLowerCase()] || ORDER_STATUS_COLORS.default;
};

export const getClientOrderStatusColor = (status: string | undefined | null) => {
  if (!status) return CLIENT_ORDER_STATUS_COLORS.created;
  return CLIENT_ORDER_STATUS_COLORS[status.toLowerCase()] || CLIENT_ORDER_STATUS_COLORS.created;
};

export const getClientTrackerStepIndex = (status: string | undefined | null) => {
  if (!status) return -1;
  const normalized = status.toLowerCase();
  if (normalized === 'created') return 0;
  if (['searching_driver', 'offered_to_driver', 'no_driver_found', 'timeout'].includes(normalized)) return 1;
  if (['driver_assigned', 'driver_accepted'].includes(normalized)) return 2;
  if (['heading_to_pickup', 'arrived_at_pickup', 'loading'].includes(normalized)) return 3;
  if (normalized === 'heading_to_client') return 4;
  if (['delivered', 'completed'].includes(normalized)) return 5;
  return -1;
};

export const isClientActiveOrderStatus = (status: string | undefined | null) => {
  if (!status) return false;
  return CLIENT_TRACKER_ACTIVE_STATUSES.includes(status.toLowerCase() as (typeof CLIENT_TRACKER_ACTIVE_STATUSES)[number]);
};
