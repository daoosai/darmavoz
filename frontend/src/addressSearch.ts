const DGIS_KEY = import.meta.env.VITE_2GIS_KEY;
const TYUMEN_CITY = "Тюмень";
const TYUMEN_LOCATION = "65.534328,57.152286";

const getText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const getAdministrativeNames = (item: any): string[] => {
  const divisions = Array.isArray(item?.adm_div)
    ? item.adm_div
    : item?.adm_div
      ? [item.adm_div]
      : [];

  return divisions
    .map((division: any) => getText(division?.name || division?.caption))
    .filter(Boolean);
};

const appendUniqueParts = (address: string, parts: string[]): string => {
  const normalizedAddress = address.toLocaleLowerCase();
  const uniqueParts = parts.filter((part, index) => {
    const normalizedPart = part.toLocaleLowerCase();
    return (
      parts.findIndex(
        (candidate) => candidate.toLocaleLowerCase() === normalizedPart,
      ) === index && !normalizedAddress.includes(normalizedPart)
    );
  });

  return [address, ...uniqueParts].filter(Boolean).join(", ");
};

export const get2gisSuggestionAddress = (item: any): string => {
  const baseAddress =
    getText(item?.full_address_name) ||
    getText(item?.full_name) ||
    getText(item?.address_name) ||
    getText(item?.address?.name) ||
    getText(item?.name) ||
    getText(item?.search_attributes?.suggested_text);

  return appendUniqueParts(baseAddress, getAdministrativeNames(item));
};

export const get2gisSuggestionLabel = (item: any): string =>
  get2gisSuggestionAddress(item);

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
      suggest_type: "address",
      key: DGIS_KEY,
      type: "adm_div.settlement,building,street",
      fields: "items.point,items.address,items.adm_div,items.full_address_name",
      location: TYUMEN_LOCATION,
      page_size: "20",
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
