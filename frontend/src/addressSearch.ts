const DGIS_KEY = import.meta.env.VITE_2GIS_KEY;
const TYUMEN_CITY = "\u0422\u044e\u043c\u0435\u043d\u044c";
const TYUMEN_LOCATION = "65.534328,57.152286";

export const get2gisSuggestionLabel = (item: any): string =>
  item?.search_attributes?.suggested_text ||
  item?.full_name ||
  item?.address_name ||
  item?.name ||
  "";

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
  if (normalized.length < 3 || !DGIS_KEY) {
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
