import { useState } from "react";

import EquipmentOwnerBottomNav, { type EquipmentOwnerTab } from "./EquipmentOwnerBottomNav";
import EquipmentOwnerProfileScreen from "./EquipmentOwnerProfileScreen";
import EquipmentOwnerRegisterScreen from "./EquipmentOwnerRegisterScreen";
import SepticProviderProfileScreen from "./SepticProviderProfileScreen";
import { logoutCurrentSession } from "./pushAuth";
import SupplierEquipmentScreen from "./SupplierEquipmentScreen";
import SupportScreen from "./SupportScreen";
import { useAuthStore } from "./store";

export default function EquipmentOwnerPortalScreen({ onBack }: { onBack: () => void }) {
  const { token, role } = useAuthStore();
  const [activeView, setActiveView] = useState<EquipmentOwnerTab>("equipment");

  if (token && role === "equipment_owner") {
    const handleLogout = async () => {
      await logoutCurrentSession();
      onBack();
    };

    return (
      <div className="min-h-screen bg-gray-50 pb-24 sm:mx-auto sm:max-w-md">
        {activeView === "support" ? (
          <SupportScreen onBack={() => setActiveView("profile")} />
        ) : activeView === "equipment" ? (
          <SupplierEquipmentScreen token={token} apiPrefix="/equipment-owner" />
        ) : activeView === "septic" ? (
          <SepticProviderProfileScreen token={token} />
        ) : (
          <EquipmentOwnerProfileScreen token={token} onLogout={handleLogout} />
        )}
        <EquipmentOwnerBottomNav activeTab={activeView} onChange={(tab) => setActiveView(tab)} />
      </div>
    );
  }

  return <EquipmentOwnerRegisterScreen onBack={onBack} />;
}
