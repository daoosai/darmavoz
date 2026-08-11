import EquipmentOwnerRegisterScreen from "./EquipmentOwnerRegisterScreen";

export default function WaterSepticPartnerRegisterScreen({ onBack }: { onBack: () => void }) {
  return (
    <EquipmentOwnerRegisterScreen
      onBack={onBack}
      registrationApiPrefix="/auth/water-septic-partner"
      partnerRole="water_septic_partner"
      title="Кабинет партнёра воды и септиков"
      description="Добавляйте точки воды и услуги по откачке септиков в одном отдельном кабинете."
    />
  );
}
