import toast from "react-hot-toast";

type ToastMessage = Parameters<typeof toast.error>[0];
type ToastOptions = Parameters<typeof toast.error>[1];

let isConfigured = false;

const getToastMessageKey = (message: ToastMessage) => {
  if (typeof message === "string") return message.trim();
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  return "";
};

export const configureToastDeduplication = () => {
  if (isConfigured) return;
  isConfigured = true;

  const originalError = toast.error.bind(toast);

  toast.error = ((message: ToastMessage, options?: ToastOptions) => {
    const messageKey = getToastMessageKey(message);
    if (!messageKey) {
      return originalError(message, options);
    }

    return originalError(message, {
      ...options,
      id: options?.id ?? `error:${messageKey}`,
    });
  }) as typeof toast.error;
};
