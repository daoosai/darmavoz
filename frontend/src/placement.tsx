import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

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

const CONFIRMATION_ACTION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const PLACEMENT_EXPIRATION_WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const PLACEMENT_TEXT = {
  warningTitle: "Внимание!",
  warningBodyPrefix: "Срок размещения истекает",
  warningBodySuffix: "Объявление будет скрыто. Пожалуйста, свяжитесь с поддержкой для продления.",
} as const;

const parsePlacementDeadline = (value?: string | null) => {
  if (!value) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  }

  return new Date(value).getTime();
};

const formatPlacementWarningDate = (value?: string | null) => {
  if (!value) return "Дата не указана";
  const timestamp = parsePlacementDeadline(value);
  if (Number.isNaN(timestamp)) return "Дата не указана";
  return new Date(timestamp).toLocaleDateString("ru-RU", { dateStyle: "long" });
};

export const shouldShowConfirmationAction = (
  item: PlacementFields,
  now: number = Date.now(),
) => {
  if (!item.can_confirm_relevance) return false;
  if (item.placement_status === "confirmation_required") return true;
  if (
    item.placement_status === "hidden" &&
    item.placement_hidden_reason === "confirmation_overdue"
  ) {
    return true;
  }
  if (!item.next_confirmation_at) return false;

  const confirmationAt = new Date(item.next_confirmation_at).getTime();
  return (
    !Number.isNaN(confirmationAt) &&
    confirmationAt <= now + CONFIRMATION_ACTION_WINDOW_MS
  );
};

const META: Record<PlacementStatus, { label: string; className: string }> = {
  active: { label: "Активно", className: "bg-emerald-100 text-emerald-700" },
  pending_moderation: {
    label: "На модерации",
    className: "bg-amber-100 text-amber-800",
  },
  hidden: { label: "Скрыто", className: "bg-slate-100 text-slate-700" },
  archived: { label: "Архив", className: "bg-gray-200 text-gray-700" },
  confirmation_required: {
    label: "Требует подтверждения",
    className: "bg-orange-100 text-orange-800",
  },
  trial: {
    label: "Тестовый период",
    className: "bg-sky-100 text-sky-800",
  },
  expired: {
    label: "Размещение завершено",
    className: "bg-rose-100 text-rose-700",
  },
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

export const shouldShowPlacementExpirationWarning = (
  item: PlacementFields,
  now: number = Date.now(),
) => {
  if (item.placement_status !== "active" && item.placement_status !== "trial") {
    return false;
  }

  const placementEndsAt =
    item.placement_ends_at || (item.placement_status === "trial" ? item.trial_ends_at : null);
  const placementDeadline = parsePlacementDeadline(placementEndsAt);
  if (Number.isNaN(placementDeadline)) {
    return false;
  }

  const timeRemaining = placementDeadline - now;
  return timeRemaining >= 0 && timeRemaining <= PLACEMENT_EXPIRATION_WARNING_WINDOW_MS;
};

export function PlacementBadge({ status }: { status?: PlacementStatus }) {
  const meta = placementMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

export function PlacementDates({ item }: { item: PlacementFields }) {
  const rows: Array<[string, ReactNode]> = [
    [
      item.placement_status === "trial"
        ? "Тестовый период до"
        : "Размещение до",
      formatPlacementDate(
        item.placement_status === "trial"
          ? item.trial_ends_at
          : item.placement_ends_at,
      ),
    ],
    [
      "Следующее подтверждение",
      formatPlacementDate(item.next_confirmation_at),
    ],
  ];

  return (
    <div className="grid gap-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap gap-1">
          <span className="text-gray-500">{label}:</span>
          <span className="text-gray-900">{value}</span>
        </div>
      ))}
      {item.placement_hidden_reason === "confirmation_overdue" ? (
        <div className="text-sm font-semibold text-rose-600">
          Скрыто из-за просроченного подтверждения
        </div>
      ) : null}
    </div>
  );
}

export function PlacementExpirationWarning({
  item,
  className = "",
}: {
  item: PlacementFields;
  className?: string;
}) {
  const placementEndsAt =
    item.placement_ends_at || (item.placement_status === "trial" ? item.trial_ends_at : null);
  if (!shouldShowPlacementExpirationWarning(item)) {
    return null;
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ${className}`.trim()}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <p>
        <span className="font-semibold">{PLACEMENT_TEXT.warningTitle}</span>{" "}
        {PLACEMENT_TEXT.warningBodyPrefix} {formatPlacementWarningDate(placementEndsAt)}.{" "}
        {PLACEMENT_TEXT.warningBodySuffix}
      </p>
    </div>
  );
}
