/** Approved audit-remediation presets; the submitted reason stays editable. */
export const wholesaleRejectReasons = [
  { label: "Неполные данные", value: "Заполните недостающие данные заявки." },
  { label: "Некорректный контакт", value: "Проверьте имя и контактный телефон." },
  { label: "Адреса", value: "Уточните адреса загрузки и доставки." },
  { label: "Условия перевозки", value: "Уточните объём, сроки и стоимость перевозки." },
] as const;
