export type CrmStatus =
  | "auto_added"
  | "invite_sent"
  | "response_received"
  | "interested"
  | "registered"
  | "registration_completed"
  | "activated"
  | "refused"
  | "call_later";

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  auto_added: "Добавлен автоматически",
  invite_sent: "Приглашение отправлено",
  response_received: "Получен ответ",
  interested: "Заинтересован",
  registered: "Зарегистрировался",
  registration_completed: "Завершил регистрацию",
  activated: "Активирован",
  refused: "Отказался",
  call_later: "Связаться позже",
};

export const CRM_STATUS_CLASSES: Record<CrmStatus, string> = {
  auto_added: "bg-slate-100 text-slate-700",
  invite_sent: "bg-amber-100 text-amber-800",
  response_received: "bg-sky-100 text-sky-800",
  interested: "bg-blue-100 text-blue-800",
  registered: "bg-indigo-100 text-indigo-800",
  registration_completed: "bg-violet-100 text-violet-800",
  activated: "bg-emerald-100 text-emerald-800",
  refused: "bg-rose-100 text-rose-800",
  call_later: "bg-amber-100 text-amber-800",
};

export const getCrmStatusLabel = (status?: string | null) =>
  status && status in CRM_STATUS_LABELS
    ? CRM_STATUS_LABELS[status as CrmStatus]
    : CRM_STATUS_LABELS.auto_added;

export const getCrmStatusClass = (status?: string | null) =>
  status && status in CRM_STATUS_CLASSES
    ? CRM_STATUS_CLASSES[status as CrmStatus]
    : CRM_STATUS_CLASSES.auto_added;
