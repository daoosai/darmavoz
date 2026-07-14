import { useAuthStore } from "./store";
import SupplierDashboardScreen from "./SupplierDashboardScreen";
import SupplierRegisterScreen from "./SupplierRegisterScreen";

export default function SupplierPortalScreen({ onBack }: { onBack: () => void }) {
  const { token, role } = useAuthStore();

  if (token && role === "supplier") {
    return <SupplierDashboardScreen token={token} onBack={onBack} />;
  }

  return <SupplierRegisterScreen onBack={onBack} />;
}
