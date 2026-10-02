import { ClipboardList, Headphones, UserRound } from "lucide-react";

export type EquipmentOwnerTab = "equipment" | "support" | "profile";

interface Props {
  activeTab: EquipmentOwnerTab;
  onChange: (tab: EquipmentOwnerTab) => void;
}

const ITEMS = [
  { id: "equipment" as const, label: "Мои объявления", icon: ClipboardList },
  { id: "support" as const, label: "Поддержка", icon: Headphones },
  { id: "profile" as const, label: "Профиль", icon: UserRound },
];

export default function EquipmentOwnerBottomNav({ activeTab, onChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 border-t border-gray-200 bg-white/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-xs font-bold transition-colors ${active ? "text-sky-600" : "text-gray-400 hover:text-gray-600"}`}
          >
            <Icon className="h-6 w-6" strokeWidth={active ? 2.5 : 2} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
