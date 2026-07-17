import { MaterialProps, DeliveryOption } from "./MaterialDetailScreen";

export const baseURL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  "/api/v1";

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || "2.5.0";

export const orderStatusColors: Record<string, string> = {
  created: "bg-gray-200 text-gray-700 border border-gray-300",
  pending: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  searching_driver:
    "bg-amber-100 text-amber-800 border border-amber-200 animate-pulse",
  offered_to_driver:
    "bg-[#2DB0E6]/10 text-purple-800 border border-[#2DB0E6]/20",
  no_driver_found: "bg-red-100 text-red-800 border border-red-200",
  driver_assigned: "bg-blue-100 text-blue-800 border border-blue-200",
  driver_accepted: "bg-blue-100 text-blue-800 border border-blue-200",
  heading_to_pickup: "bg-indigo-100 text-indigo-800 border border-indigo-200",
  arrived_at_pickup: "bg-indigo-100 text-indigo-800 border border-indigo-200",
  loading: "bg-indigo-100 text-indigo-800 border border-indigo-200",
  heading_to_client: "bg-green-100 text-green-800 border border-green-200",
  delivered: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  completed: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  cancelled: "bg-red-100 text-red-800 border border-red-200",
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

const formatValidationErrors = (detail: any[]): string | null => {
  const messages = detail
    .map((entry: any) => {
      if (!entry) return null;
      if (typeof entry === "string") return entry;
      if (typeof entry.msg === "string") {
        const field =
          Array.isArray(entry.loc) && entry.loc.length > 0
            ? entry.loc[entry.loc.length - 1]
            : "";
        return field ? `${field}: ${entry.msg}` : entry.msg;
      }
      return null;
    })
    .filter(Boolean);

  if (messages.length === 0) {
    return null;
  }

  return messages.join(", ");
};

const RUSSIAN_FALLBACKS_BY_STATUS: Record<number, string> = {
  400: "Неверный запрос",
  401: "Требуется авторизация",
  403: "Нет доступа",
  404: "Ресурс не найден",
  405: "Метод запроса не поддерживается",
  422: "Проверьте правильность заполнения полей",
  500: "Ошибка сервера",
};

const getStatusCode = (source: any): number | null => {
  const statusCode = source?.status ?? source?.response?.status ?? source?.response?.data?.status;
  return typeof statusCode === "number" ? statusCode : null;
};

const getRussianStatusFallback = (statusCode: number | null, fallbackMessage: string) => {
  if (statusCode == null) return fallbackMessage;
  if (statusCode >= 500) return RUSSIAN_FALLBACKS_BY_STATUS[500];
  return RUSSIAN_FALLBACKS_BY_STATUS[statusCode] || fallbackMessage;
};

const containsCyrillic = (value: string) => /[А-Яа-яЁё]/.test(value);
const containsEnglish = (value: string) => /[A-Za-z]/.test(value);

const sanitizeApiMessage = (
  message: string | null | undefined,
  statusCode: number | null,
  fallbackMessage: string,
) => {
  const normalized = message?.trim();
  if (!normalized) {
    return getRussianStatusFallback(statusCode, fallbackMessage);
  }
  if (containsCyrillic(normalized)) {
    return normalized;
  }
  if (containsEnglish(normalized)) {
    return getRussianStatusFallback(statusCode, fallbackMessage);
  }
  return normalized;
};

export const extractApiErrorMessage = (
  source: any,
  fallbackMessage: string = "Не удалось выполнить действие",
): string => {
  if (!source) {
    return fallbackMessage;
  }

  const statusCode = getStatusCode(source);
  const detail =
    source.detail ??
    source.response?.data?.detail ??
    source.data?.detail ??
    source.error?.detail;

  if (Array.isArray(detail)) {
    const validationMessage = formatValidationErrors(detail);
    return sanitizeApiMessage(validationMessage, statusCode ?? 422, fallbackMessage);
  }

  if (typeof detail === "string" && detail.trim()) {
    return sanitizeApiMessage(detail, statusCode, fallbackMessage);
  }

  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string" && detail.message.trim()) {
      return sanitizeApiMessage(detail.message, statusCode, fallbackMessage);
    }
    if (typeof detail.msg === "string" && detail.msg.trim()) {
      return sanitizeApiMessage(detail.msg, statusCode, fallbackMessage);
    }
  }

  if (statusCode != null) {
    return getRussianStatusFallback(statusCode, fallbackMessage);
  }

  const message =
    source.message ??
    source.response?.data?.message ??
    source.data?.message ??
    source.error?.message;

  if (typeof message === "string" && message.trim()) {
    return sanitizeApiMessage(message, statusCode, fallbackMessage);
  }

  return fallbackMessage;
};

export const handleApiError = (
  error: any,
  fallbackMessage: string = "Не удалось выполнить действие",
): string => {
  if (!error) return fallbackMessage;

  const statusCode = getStatusCode(error);
  const rawMessage =
    error?.message ??
    error?.response?.data?.detail ??
    error?.response?.data?.message ??
    "";
  const lowerRawMessage = typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";

  if (
    (error instanceof TypeError && lowerRawMessage.includes("fetch")) ||
    rawMessage === "Failed to fetch" ||
    rawMessage === "Network Error" ||
    lowerRawMessage.includes("failed to fetch") ||
    lowerRawMessage.includes("network error")
  ) {
    return "Ошибка сети. Проверьте подключение к интернету.";
  }

  if ((statusCode ?? 0) >= 500) {
    return "Ошибка сервера. Попробуйте позже.";
  }

  if (
    error.code === "ECONNABORTED" ||
    lowerRawMessage.includes("timeout") ||
    error.name === "AbortError"
  ) {
    return "Превышено время ожидания ответа от сервера.";
  }

  const msg = extractApiErrorMessage(error, getRussianStatusFallback(statusCode, fallbackMessage));
  if (containsEnglish(msg)) {
    return getRussianStatusFallback(statusCode, fallbackMessage);
  }

  return msg || fallbackMessage;
};

export const declineReasonMap: Record<string, string> = {
  manual: "Отказ водителя (вручную)",
  timeout: "Время истекло (без ответа)",
  "Driver response timeout": "Время ожидания истекло (нет ответа)",
  offline: "Водитель не в сети",
  busy: "Водитель занят",
};

export const attemptStatusMap: Record<string, string> = {
  assigned: "НАЗНАЧЕН",
  accepted: "ПРИНЯТО",
  declined: "ОТКЛОНЕН",
  rejected: "ОТКЛОНЕН",
  expired: "ИСТЕК ТАЙМАУТ",
  timeout: "ИСТЕК ТАЙМАУТ",
  offered: "ПРЕДЛОЖЕНО",
  pending: "ОЖИДАНИЕ",
  cancelled: "ОТМЕНЕН",
  completed: "ЗАВЕРШЕН",
};

export const translateReason = (reason: string | undefined | null) => {
  if (!reason) return "Причина не указана";
  const normalizedReason = reason.toLowerCase();
  if (normalizedReason.includes("manual assignment")) return "Назначено логистом вручную";
  if (normalizedReason.includes("driver declined") || normalizedReason.includes("rejected") || normalizedReason === "manual") {
    return "Отказ водителя";
  }
  if (normalizedReason.includes("timeout") || normalizedReason.includes("expired")) {
    return "Время ожидания истекло";
  }
  if (normalizedReason.includes("cancelled by client")) return "Отменено клиентом";
  if (normalizedReason.includes("cancelled by logist")) return "Отменено логистом";
  return reason;
};

export const clientOrderStatusColors: Record<string, string> = {
  created: "bg-gray-100 text-gray-700 border border-gray-200",
  searching_driver: "bg-gray-100 text-gray-600 border border-gray-200",
  offered_to_driver: "bg-gray-100 text-gray-600 border border-gray-200",
  no_driver_found: "bg-gray-100 text-gray-600 border border-gray-200",
  driver_assigned: "bg-blue-100 text-blue-600 border border-blue-200",
  driver_accepted: "bg-blue-100 text-blue-600 border border-blue-200",
  heading_to_pickup: "bg-indigo-100 text-indigo-600 border border-indigo-200",
  arrived_at_pickup: "bg-indigo-100 text-indigo-600 border border-indigo-200",
  loading: "bg-indigo-100 text-indigo-600 border border-indigo-200",
  heading_to_client: "bg-emerald-100 text-emerald-600 border border-emerald-200",
  delivered: "bg-green-100 text-green-700 border border-green-200",
  completed: "bg-green-100 text-green-700 border border-green-200",
  cancelled: "bg-red-100 text-red-600 border border-red-200",
  canceled: "bg-red-100 text-red-600 border border-red-200",
};

export const getImageUrl = (item: MaterialProps | DeliveryOption) => {
  return (
    item.primary_image_url ||
    item?.media_files?.[0]?.public_url ||
    item.image_url ||
    "/placeholder.jpg"
  );
};

export const resolveMediaUrl = (imageUrl?: string | null) => {
  if (!imageUrl) return null;
  if (/^(https?:|data:|blob:)/i.test(imageUrl)) return imageUrl;

  try {
    const runtimeOrigin =
      typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const configuredMediaBase =
      import.meta.env.VITE_S3_URL ||
      import.meta.env.VITE_API_BASE_URL ||
      baseURL;
    const mediaBaseUrl = new URL(configuredMediaBase, runtimeOrigin);
    if (!mediaBaseUrl.pathname.endsWith("/")) {
      mediaBaseUrl.pathname += "/";
    }
    return new URL(imageUrl, mediaBaseUrl).toString();
  } catch {
    return imageUrl;
  }
};
