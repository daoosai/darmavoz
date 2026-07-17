import toast from "react-hot-toast";

type ToastMessage = Parameters<typeof toast.error>[0];
type ToastOptions = Parameters<typeof toast.error>[1];

let isConfigured = false;

const getToastMessageKey = (message: ToastMessage) => {
  if (typeof message === "string") return message.trim();
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  return "";
};

const sanitizeToastErrorMessage = (message: ToastMessage): ToastMessage => {
  if (typeof message !== "string") return message;
  const normalized = message.trim();
  if (!normalized) return message;
  if (/[А-Яа-яЁё]/.test(normalized)) return normalized;

  const lower = normalized.toLowerCase();
  if (lower.includes("not found")) return "Ресурс не найден";
  if (lower.includes("validation")) return "Проверьте правильность заполнения полей";
  if (lower.includes("internal server error")) return "Внутренняя ошибка сервера. Повторите попытку позже";
  if (lower.includes("unauthorized") || lower.includes("could not validate credentials")) {
    return "Требуется авторизация";
  }
  if (lower.includes("forbidden") || lower.includes("not enough permissions")) {
    return "Нет доступа";
  }
  if (lower.includes("network") || lower.includes("failed to fetch")) {
    return "Ошибка сети. Проверьте подключение к интернету.";
  }
  if (/[A-Za-z]/.test(normalized)) return "Не удалось выполнить действие";
  return normalized;
};

export const configureToastDeduplication = () => {
  if (isConfigured) return;
  isConfigured = true;

  const originalError = toast.error.bind(toast);

  toast.error = ((message: ToastMessage, options?: ToastOptions) => {
    const sanitizedMessage = sanitizeToastErrorMessage(message);
    const messageKey = getToastMessageKey(sanitizedMessage);
    if (!messageKey) {
      return originalError(sanitizedMessage, options);
    }

    return originalError(sanitizedMessage, {
      ...options,
      id: options?.id ?? `error:${messageKey}`,
    });
  }) as typeof toast.error;
};
