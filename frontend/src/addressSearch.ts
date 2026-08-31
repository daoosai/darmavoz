const DGIS_KEY = import.meta.env.VITE_2GIS_KEY;
const TYUMEN_CITY = "Тюмень";
const TYUMEN_LOCATION = "65.534328,57.152286";
const TWOGIS_SUGGEST_URL = "https://catalog.api.2gis.com/3.0/suggests";
const TWOGIS_ADDRESS_SUGGEST_TYPES = [
  "building",
  "street",
  "adm_div.city",
  "adm_div.settlement",
  "adm_div.district",
  "adm_div.division",
  "adm_div.living_area",
  "adm_div.place",
].join(",");

type SuggestApiError = Error & {
  response?: {
    status: number;
    data: unknown;
  };
};

const logSuggestError = (error: unknown) => {
  console.error(
    "2GIS Suggest API Error:",
    (error as SuggestApiError).response?.data || error,
  );
};

const getRequestUrlForLog = (requestUrl: URL) => {
  const safeUrl = new URL(requestUrl);
  safeUrl.searchParams.set("key", "<redacted>");
  return safeUrl.toString();
};

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
  if (normalized.length < 3) {
    return [];
  }

  if (!DGIS_KEY) {
    logSuggestError(new Error("VITE_2GIS_KEY is not configured at build time"));
    return [];
  }

  const requestUrl = new URL(TWOGIS_SUGGEST_URL);
  requestUrl.search = new URLSearchParams({
    q: normalized,
    key: DGIS_KEY,
    type: TWOGIS_ADDRESS_SUGGEST_TYPES,
    fields: "items.point,items.address,items.adm_div,items.full_address_name",
    location: TYUMEN_LOCATION,
    page_size: "20",
    locale: "ru_RU",
  }).toString();

  try {
    const response = await fetch(requestUrl);
    const data = await response.json();

    if (!response.ok) {
      const error = Object.assign(
        new Error(`2GIS Suggest API responded with ${response.status}`),
        { response: { status: response.status, data } },
      );
      logSuggestError(error);
      return [];
    }

    const items = Array.isArray(data?.result?.items) ? data.result.items : [];
    if (items.length === 0) {
      console.warn(
        "2GIS returned empty result for query:",
        normalized,
        "URL:",
        getRequestUrlForLog(requestUrl),
      );
    }

    return items;
  } catch (error) {
    logSuggestError(error);
    return [];
  }
};
