const DGIS_KEY = import.meta.env.VITE_2GIS_KEY;
const TYUMEN_CITY = "Тюмень";

export const get2gisSuggestionLabel = (item: any): string =>
  item?.search_attributes?.suggested_text ||
  item?.full_name ||
  item?.address_name ||
  item?.name ||
  "";

export const get2gisSuggestionAddress = (item: any): string =>
  item?.full_name ||
  item?.address_name ||
  item?.name ||
  get2gisSuggestionLabel(item);

export const get2gisSuggestionCoordinates = (
  item: any,
): { lat?: number; lon?: number } => {
  if (typeof item?.point === "string") {
    const [pointLon, pointLat] = item.point.split(",").map(Number);
    if (Number.isFinite(pointLat) && Number.isFinite(pointLon)) {
      return { lat: pointLat, lon: pointLon };
    }
  }

  const pointLat = Number(item?.point?.lat);
  const pointLon = Number(item?.point?.lon);
  if (Number.isFinite(pointLat) && Number.isFinite(pointLon)) {
    return { lat: pointLat, lon: pointLon };
  }

  const directLat = Number(item?.lat);
  const directLon = Number(item?.lon);
  if (Number.isFinite(directLat) && Number.isFinite(directLon)) {
    return { lat: directLat, lon: directLon };
  }

  return {};
};

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
  const normalized = query.trim();
  if (normalized.length < 3 || !DGIS_KEY) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: normalized,
      suggest_type: "city_selector",
      key: DGIS_KEY,
      fields: "items.point",
      locale: "ru_RU",
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
