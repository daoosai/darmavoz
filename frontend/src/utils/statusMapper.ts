export const ORDER_STATUSES_RU: Record<string, string> = {
  created: 'Создан',
  searching_driver: 'Поиск водителя',
  driver_assigned: 'Назначен',
  driver_accepted: 'Принят',
  heading_to_pickup: 'Выехал на загрузку',
  arrived_at_pickup: 'Прибыл на загрузку',
  loading: 'Загрузка',
  heading_to_client: 'Едет к клиенту',
  delivered: 'Доставил',
  completed: 'Завершён',
  cancelled: 'Отменён',
  canceled: 'Отменён',
  timeout: 'Таймаут (нет ответа)',
  no_driver_found: 'Нет исполнителя',
  driver_cancel: 'Отказ водителя'
};

export const getOrderStatusText = (status: string | undefined | null) => {
  if (!status) return 'Неизвестно';
  return ORDER_STATUSES_RU[status.toLowerCase()] || status;
};
