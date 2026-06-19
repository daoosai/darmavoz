import { MaterialProps, DeliveryOption } from './MaterialDetailScreen';

export const baseURL = 'https://darmavoz.ru/api/v1';

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || "2.0.0";

export const orderStatusMap: Record<string, string> = {
  'created': 'СОЗДАН',
  'pending': 'В ПОИСКЕ',
  'searching_driver': 'ИДЕТ ПОИСК',
  'offered_to_driver': 'ПРЕДЛОЖЕН ВОДИТЕЛЮ',
  'no_driver_found': 'НЕТ СВОБОДНЫХ МАШИН',
  'driver_assigned': 'НАЗНАЧЕН',
  'in_progress': 'В ПУТИ',
  'completed': 'ПОЛУЧЕН',
  'cancelled': 'ОТМЕНЕН',
};

export const orderStatusColors: Record<string, string> = {
  'created': 'bg-gray-200 text-gray-700 border border-gray-300',
  'pending': 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  'searching_driver': 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse',
  'offered_to_driver': 'bg-[#2DB0E6]/10 text-purple-800 border border-[#2DB0E6]/20',
  'no_driver_found': 'bg-red-100 text-red-800 border border-red-200',
  'driver_assigned': 'bg-blue-100 text-blue-800 border border-blue-200',
  'in_progress': 'bg-green-100 text-green-800 border border-green-200',
  'completed': 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'cancelled': 'bg-red-100 text-red-800 border border-red-200',
};

export const formatPhoneNumber = (value: string) => {
  if (!value) return "";
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("7") || digits.startsWith("8")) {
    digits = digits.substring(1);
  }
  digits = digits.substring(0, 10);
  
  if (digits.length === 0) return "";

  let formatted = "+7";
  if (digits.length > 0) {
    formatted += " (" + digits.substring(0, 3);
  }
  if (digits.length >= 4) {
    formatted += ") " + digits.substring(3, 6);
  }
  if (digits.length >= 7) {
    formatted += "-" + digits.substring(6, 8);
  }
  if (digits.length >= 9) {
    formatted += "-" + digits.substring(8, 10);
  }
  return formatted;
};

export const formatErrorToRussian = (error: any, fallbackMessage: string): string => {
  if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
    return 'Ошибка сети. Отключите VPN или проверьте интернет-соединение.';
  }
  if (error?.message) {
    if (error.message.toLowerCase().includes('failed to fetch') || error.message.toLowerCase().includes('network error')) {
      return 'Ошибка сети. Отключите VPN или проверьте интернет-соединение.';
    }
    if (/[A-Za-z]/.test(error.message)) {
      return fallbackMessage;
    }
    return error.message;
  }
  return fallbackMessage;
};

export const declineReasonMap: Record<string, string> = {
  'manual': 'Отказ водителя (вручную)',
  'timeout': 'Время истекло (без ответа)',
  'Driver response timeout': 'Время ожидания истекло (нет ответа)',
  'offline': 'Водитель не в сети',
  'busy': 'Водитель занят'
};

export const attemptStatusMap: Record<string, string> = {
  'accepted': 'Принято',
  'declined': 'Отклонено',
  'expired': 'Истекло',
  'timeout': 'Истекло',
  'offered': 'Предложено',
  'pending': 'Ожидание'
};

export const clientOrderStatusMap: Record<string, string> = {
  'created': 'Заказ создан',
  'searching_driver': 'Ищем водителя',
  'offered_to_driver': 'Ищем водителя',
  'no_driver_found': 'Ищем водителя',
  'driver_assigned': 'Водитель назначен',
  'in_progress': 'В ПУТИ',
  'completed': 'ПОЛУЧЕН',
  'cancelled': 'Отменен',
};

export const clientOrderStatusColors: Record<string, string> = {
  'created': 'bg-gray-100 text-gray-700 border border-gray-200',
  'searching_driver': 'bg-blue-50 text-blue-700 border border-blue-200',
  'offered_to_driver': 'bg-blue-50 text-blue-700 border border-blue-200',
  'no_driver_found': 'bg-blue-50 text-blue-700 border border-blue-200',
  'driver_assigned': 'bg-blue-100 text-blue-800 border border-blue-300',
  'in_progress': 'bg-[#2DB0E6]/10 text-[#2DB0E6] border border-[#2DB0E6]/20',
  'completed': 'bg-green-100 text-green-800 border border-green-200',
  'cancelled': 'bg-slate-100 text-slate-600 border border-slate-200',
};

export const getImageUrl = (item: MaterialProps | DeliveryOption) => {
  return item.primary_image_url || item?.media_files?.[0]?.public_url || item.image_url || "/placeholder.jpg";
};
