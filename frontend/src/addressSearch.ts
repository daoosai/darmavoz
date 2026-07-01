const DGIS_KEY = "1ee6f536-8494-4bb2-adc0-d011444c567a";
const TYUMEN_CITY = "Тюмень";
const TYUMEN_LOCATION = "65.534328,57.152286";

export const withTyumenBias = (address: string): string => {
  const normalized = address.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.toLowerCase().includes(TYUMEN_CITY.toLowerCase())) {
    return normalized;
  }
  return `${TYUMEN_CITY} ${normalized}`;
};

export const fetch2gisAddressSuggestions = async (
  query: string,
): Promise<any[]> => {
  const normalized = withTyumenBias(query);
  if (normalized.length < 3) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: normalized,
      suggest_type: "address",
      key: DGIS_KEY,
      location: TYUMEN_LOCATION,
      radius: "40000",
    });
    const response = await fetch(
      `https://catalog.api.2gis.com/3.0/suggests?${params.toString()}`,
    );
    const data = await response.json();
    return data.result?.items || [];
  } catch {
    return [];
  }
};
