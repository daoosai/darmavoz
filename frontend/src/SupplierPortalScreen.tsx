import { useState } from "react";

import { logoutCurrentSession } from "./pushAuth";
import { useAuthStore } from "./store";
import SupplierBottomNav, { type SupplierTab } from "./SupplierBottomNav";
import SupplierDashboardScreen from "./SupplierDashboardScreen";
import SupplierProfileScreen from "./SupplierProfileScreen";
import SupplierRegisterScreen from "./SupplierRegisterScreen";

export default function SupplierPortalScreen({ onBack }: { onBack: () => void }) {
  const { token, role } = useAuthStore();
  const [activeTab, setActiveTab] = useState<SupplierTab>("points");

  if (token && role === "supplier") {
    const handleLogout = async () => {
      await logoutCurrentSession();
      onBack();
    };

    return (
        <div className="min-h-screen bg-gray-50 pb-24 sm:mx-auto sm:max-w-md">
        {activeTab === "points" ? (
          <SupplierDashboardScreen
            token={token}
            onRequireProfile={() => setActiveTab("profile")}
          />
        ) : (
          <SupplierProfileScreen token={token} onLogout={handleLogout} />
        )}
        <SupplierBottomNav activeTab={activeTab} onChange={setActiveTab} />
      </div>
    );
  }

  return <SupplierRegisterScreen onBack={onBack} />;
}
