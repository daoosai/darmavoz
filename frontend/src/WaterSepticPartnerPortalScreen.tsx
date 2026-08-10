import { useState } from "react";

import EquipmentOwnerProfileScreen from "./EquipmentOwnerProfileScreen";
import SepticProviderProfileScreen from "./SepticProviderProfileScreen";
import { logoutCurrentSession } from "./pushAuth";
import SupplierWaterPointsScreen from "./SupplierWaterPointsScreen";
import SupportScreen from "./SupportScreen";
import { useAuthStore } from "./store";
import WaterSepticPartnerBottomNav, {
  type WaterSepticPartnerTab,
} from "./WaterSepticPartnerBottomNav";
import WaterSepticPartnerRegisterScreen from "./WaterSepticPartnerRegisterScreen";

export default function WaterSepticPartnerPortalScreen({ onBack }: { onBack: () => void }) {
  const { token, role } = useAuthStore();
  const [activeView, setActiveView] = useState<WaterSepticPartnerTab>("water");

  if (token && role === "water_septic_partner") {
    const handleLogout = async () => {
      await logoutCurrentSession();
      onBack();
    };

    return (
      <div className="min-h-screen bg-gray-50 pb-24 sm:mx-auto sm:max-w-md">
        {activeView === "water" ? (
          <SupplierWaterPointsScreen
            token={token}
            apiPrefix="/water-septic-partner"
            draftStorageKey="water_septic_partner_water_point_draft"
          />
        ) : activeView === "septic" ? (
          <SepticProviderProfileScreen token={token} apiPrefix="/water-septic-partner" />
        ) : activeView === "support" ? (
          <SupportScreen onBack={() => setActiveView("water")} />
        ) : (
          <EquipmentOwnerProfileScreen
            token={token}
            onLogout={handleLogout}
            apiPrefix="/water-septic-partner"
            profileId="water_septic_partner"
            cabinetLabel="Кабинет партнёра воды и септиков"
          />
        )}
        <WaterSepticPartnerBottomNav
          activeTab={activeView}
          onChange={(tab) => setActiveView(tab)}
        />
      </div>
    );
  }

  return <WaterSepticPartnerRegisterScreen onBack={onBack} />;
}
