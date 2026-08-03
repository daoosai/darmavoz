import { useEffect } from "react";

import { type PlacementStatus } from "../../placement";
import { usePlacementStore } from "../../store";

type ManagedSection = "quarries" | "equipment";
type EquipmentTab = "listings" | "moderation" | "types";

interface PointFilters {
  statusFilter: string;
  placementFilter: PlacementStatus | "";
  typeFilter: string;
}

interface EquipmentFilters {
  placementFilter: PlacementStatus | "";
  tab: EquipmentTab;
}

export default function PlacementSummaryPanel({
  token,
  activeSection,
  pointFilters,
  equipmentFilters,
  onOpenPoints,
  onOpenEquipment,
}: {
  token: string;
  activeSection: ManagedSection | null;
  pointFilters: PointFilters;
  equipmentFilters: EquipmentFilters;
  onOpenPoints: (filters: Partial<PointFilters>) => void;
  onOpenEquipment: (filters: Partial<EquipmentFilters>) => void;
}) {
  const { summary, isLoading, loadSummary } = usePlacementStore();

  useEffect(() => {
    void loadSummary(token);
  }, [loadSummary, token]);

  if (isLoading && !summary) {
    return <div className="rounded-2xl bg-white p-5 text-sm text-slate-500 shadow-sm">Загружаем сводку размещений…</div>;
  }
  if (!summary) return null;

  const openStatusCard = (placementStatus: PlacementStatus) => {
    if (activeSection === "equipment") {
      onOpenEquipment({ tab: "listings", placementFilter: placementStatus });
      return;
    }
    onOpenPoints({
      statusFilter: "",
      placementFilter: placementStatus,
      typeFilter: "",
    });
  };

  const isPointCardActive = (placementStatus: PlacementStatus, typeFilter: string) =>
    activeSection === "quarries" &&
    pointFilters.statusFilter === "" &&
    pointFilters.placementFilter === placementStatus &&
    pointFilters.typeFilter === typeFilter;

  const isStatusCardActive = (placementStatus: PlacementStatus) => {
    if (activeSection === "equipment") {
      return (
        equipmentFilters.tab === "listings" &&
        equipmentFilters.placementFilter === placementStatus
      );
    }
    return (
      activeSection === "quarries" &&
      pointFilters.statusFilter === "" &&
      pointFilters.placementFilter === placementStatus &&
      pointFilters.typeFilter === ""
    );
  };

  const cards = [
    {
      key: "active-quarries",
      label: "Активные карьеры",
      value: summary.active_quarries,
      isActive: isPointCardActive("active", "quarry"),
      onClick: () =>
        onOpenPoints({
          statusFilter: "",
          placementFilter: "active",
          typeFilter: "quarry",
        }),
    },
    {
      key: "active-accumulators",
      label: "Активные накопители",
      value: summary.active_accumulators,
      isActive: isPointCardActive("active", "accumulator"),
      onClick: () =>
        onOpenPoints({
          statusFilter: "",
          placementFilter: "active",
          typeFilter: "accumulator",
        }),
    },
    {
      key: "active-equipment",
      label: "Активная спецтехника",
      value: summary.active_equipment,
      isActive:
        activeSection === "equipment" &&
        equipmentFilters.tab === "listings" &&
        equipmentFilters.placementFilter === "active",
      onClick: () => onOpenEquipment({ tab: "listings", placementFilter: "active" }),
    },
    {
      key: "trial",
      label: "Тестовый период",
      value: summary.totals.trial,
      isActive: isStatusCardActive("trial"),
      onClick: () => openStatusCard("trial"),
    },
    {
      key: "confirmation-required",
      label: "Требует подтверждения",
      value: summary.totals.confirmation_required,
      isActive: isStatusCardActive("confirmation_required"),
      onClick: () => openStatusCard("confirmation_required"),
    },
    {
      key: "hidden",
      label: "Скрыто",
      value: summary.totals.hidden,
      isActive: isStatusCardActive("hidden"),
      onClick: () => openStatusCard("hidden"),
    },
    {
      key: "expired",
      label: "Размещение завершено",
      value: summary.totals.expired,
      isActive: isStatusCardActive("expired"),
      onClick: () => openStatusCard("expired"),
    },
    {
      key: "archived",
      label: "Архив",
      value: summary.totals.archived,
      isActive: isStatusCardActive("archived"),
      onClick: () => openStatusCard("archived"),
    },
  ] as const;

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Актуальность размещений</h2>
          <p className="text-xs text-slate-500">Продление по умолчанию: {summary.policy.extension_days} дней</p>
        </div>
        <button type="button" onClick={() => void loadSummary(token)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Обновить</button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={card.onClick}
            className={`rounded-xl border p-3 text-left transition ${
              card.isActive
                ? "border-sky-300 bg-sky-50 ring-2 ring-sky-500/60"
                : "border-slate-100 bg-slate-50 hover:border-sky-200 hover:bg-sky-50"
            }`}
          >
            <div className="text-2xl font-black text-slate-900">{card.value}</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">{card.label}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
