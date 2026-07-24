import { useState } from "react";

import { logoutCurrentSession } from "./pushAuth";
import { useAuthStore } from "./store";
import SupplierBottomNav, { type SupplierTab } from "./SupplierBottomNav";
import SupplierDashboardScreen from "./SupplierDashboardScreen";
import SupplierEquipmentScreen from "./SupplierEquipmentScreen";
import SupplierProfileScreen from "./SupplierProfileScreen";
import SupplierRegisterScreen from "./SupplierRegisterScreen";
import SupportScreen from "./SupportScreen";

export default function SupplierPortalScreen({ onBack }: { onBack: () => void }) {
  const { token, role } = useAuthStore();
  const [activeView, setActiveView] = useState<SupplierTab | "support">("points");

  if (token && role === "supplier") {
    const handleLogout = async () => {
      await logoutCurrentSession();
      onBack();
    };
    const activeTab: SupplierTab = activeView === "support" ? "profile" : activeView;

    return (
      <div className="min-h-screen bg-gray-50 pb-24 sm:mx-auto sm:max-w-md">
        {activeView === "support" ? (
          <SupportScreen onBack={() => setActiveView("profile")} />
        ) : activeTab === "points" ? (
          <SupplierDashboardScreen
            token={token}
            onRequireProfile={() => setActiveView("profile")}
          />
        ) : activeTab === "equipment" ? (
          <SupplierEquipmentScreen token={token} />
        ) : (
          <SupplierProfileScreen
            token={token}
            onLogout={handleLogout}
            onOpenSupport={() => setActiveView("support")}
          />
        )}
        {activeView !== "support" ? (
          <SupplierBottomNav activeTab={activeTab} onChange={(tab) => setActiveView(tab)} />
        ) : null}
      </div>
    );
  }

  return <SupplierRegisterScreen onBack={onBack} />;
}
