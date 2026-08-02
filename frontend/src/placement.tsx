import type { ReactNode } from "react";

export type PlacementStatus =
  | "active"
  | "pending_moderation"
  | "hidden"
  | "archived"
  | "confirmation_required"
  | "trial"
  | "expired";

export interface PlacementFields {
  placement_status?: PlacementStatus;
  placement_started_at?: string | null;
  trial_ends_at?: string | null;
  placement_ends_at?: string | null;
  last_confirmed_at?: string | null;
  next_confirmation_at?: string | null;
  confirmation_grace_ends_at?: string | null;
  placement_hidden_reason?: string | null;
  archived_at?: string | null;
  can_confirm_relevance?: boolean;
  can_extend_placement?: boolean;
}

export interface PlacementPolicy {
  trial_days: number;
  extension_days: number;
  confirmation_interval_days: number;
  confirmation_grace_days: number;
}

export interface PlacementSummary {
  generated_at: string;
  policy: PlacementPolicy;
  totals: Record<PlacementStatus, number>;
  by_entity: Record<string, Record<PlacementStatus, number>>;
  active_quarries: number;
  active_accumulators: number;
  active_equipment: number;
}

const META: Record<PlacementStatus, { label: string; className: string }> = {
  active: { label: "Активно", className: "bg-emerald-100 text-emerald-700" },
  pending_moderation: { label: "На модерации", className: "bg-amber-100 text-amber-800" },
  hidden: { label: "Скрыто", className: "bg-slate-100 text-slate-700" },
  archived: { label: "Архив", className: "bg-gray-200 text-gray-700" },
  confirmation_required: { label: "Требует подтверждения", className: "bg-orange-100 text-orange-800" },
  trial: { label: "Тестовый период", className: "bg-sky-100 text-sky-800" },
  expired: { label: "Размещение завершено", className: "bg-rose-100 text-rose-700" },
};

export const placementMeta = (status?: PlacementStatus) =>
  META[status || "pending_moderation"];

export const formatPlacementDate = (value?: string | null) => {
  if (!value) return "Не ограничено";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Дата не указана"
    : date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
};

export function PlacementBadge({ status }: { status?: PlacementStatus }) {
  const meta = placementMeta(status);
  return <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ${meta.className}`}>{meta.label}</span>;
}

export function PlacementDates({ item }: { item: PlacementFields }) {
  const rows: Array<[string, ReactNode]> = [
    [item.placement_status === "trial" ? "Тестовый период до" : "Размещение до", formatPlacementDate(item.placement_status === "trial" ? item.trial_ends_at : item.placement_ends_at)],
    ["Следующее подтверждение", formatPlacementDate(item.next_confirmation_at)],
  ];
  return (
    <div className="grid gap-1 text-xs text-slate-500">
      {rows.map(([label, value]) => <div key={label}><span className="font-semibold">{label}:</span> {value}</div>)}
      {item.placement_hidden_reason === "confirmation_overdue" ? <div className="font-semibold text-rose-600">Скрыто из-за просроченного подтверждения</div> : null}
    </div>
  );
}
