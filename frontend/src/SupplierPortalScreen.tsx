import { useState } from "react";

import { logoutCurrentSession } from "./pushAuth";
import SupportScreen from "./SupportScreen";
import { useAuthStore } from "./store";
import SupplierBottomNav, { type SupplierTab } from "./SupplierBottomNav";
import SupplierDashboardScreen from "./SupplierDashboardScreen";
import SupplierProfileScreen from "./SupplierProfileScreen";
import SupplierRegisterScreen from "./SupplierRegisterScreen";

export default function SupplierPortalScreen({ onBack }: { onBack: () => void }) {
  const { token, role } = useAuthStore();
  const [activeView, setActiveView] = useState<SupplierTab>("points");

  if (token && role === "supplier") {
    const handleLogout = async () => {
      await logoutCurrentSession();
      onBack();
    };

    return (
      <div className="min-h-screen bg-gray-50 pb-24 sm:mx-auto sm:max-w-md">
        {activeView === "support" ? (
          <SupportScreen onBack={() => setActiveView("profile")} />
        ) : activeView === "points" ? (
          <SupplierDashboardScreen
            token={token}
            onRequireProfile={() => setActiveView("profile")}
          />
        ) : (
          <SupplierProfileScreen
            token={token}
            onLogout={handleLogout}
            onOpenSupport={() => setActiveView("support")}
          />
        )}
        <SupplierBottomNav activeTab={activeView} onChange={(tab) => setActiveView(tab)} />
      </div>
    );
  }

  return <SupplierRegisterScreen onBack={onBack} />;
}
