export type CrmStatus = "parsed" | "active" | "rejected" | "invite_sent";

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  parsed: "Распарсена",
  active: "Активна",
  rejected: "Отклонена",
  invite_sent: "Отправлено приглашение",
};

export const getCrmStatusLabel = (status?: string | null) =>
  status ? CRM_STATUS_LABELS[status as CrmStatus] ?? status : CRM_STATUS_LABELS.active;
