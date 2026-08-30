export type CrmStatus = "parsed" | "in_progress" | "agreed" | "hidden";

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  parsed: "Новая (Желтая)",
  in_progress: "В работе (Серая)",
  agreed: "Согласовано (Зеленая)",
  hidden: "Скрыто",
};

export const CRM_STATUS_CLASSES: Record<CrmStatus, string> = {
  parsed: "bg-yellow-100 text-yellow-900",
  in_progress: "bg-slate-200 text-slate-800",
  agreed: "bg-emerald-100 text-emerald-800",
  hidden: "bg-slate-600 text-white",
};

export const getCrmStatusLabel = (status?: string | null) =>
  status && status in CRM_STATUS_LABELS
    ? CRM_STATUS_LABELS[status as CrmStatus]
    : CRM_STATUS_LABELS.parsed;

export const getCrmStatusClass = (status?: string | null) =>
  status && status in CRM_STATUS_CLASSES
    ? CRM_STATUS_CLASSES[status as CrmStatus]
    : CRM_STATUS_CLASSES.parsed;
