type RussianPluralForms = readonly [one: string, few: string, many: string];

export const pluralizeRussian = (count: number, [one, few, many]: RussianPluralForms) => {
  const normalizedCount = Math.abs(Math.trunc(count));
  const lastTwoDigits = normalizedCount % 100;
  const lastDigit = normalizedCount % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return many;
  if (lastDigit === 1) return one;
  if (lastDigit >= 2 && lastDigit <= 4) return few;
  return many;
};

export const formatTripsCount = (count: number) =>
  `${count} ${pluralizeRussian(count, ["рейс", "рейса", "рейсов"])}`;
