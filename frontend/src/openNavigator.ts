import { Capacitor } from "@capacitor/core";

type NavigatorTarget = {
  lat?: number | null;
  lon?: number | null;
  address?: string | null;
  label?: string | null;
};

const MOBILE_DEVICE_REGEX = /Android|iPhone|iPad|iPod/i;

const isMobileNavigatorPlatform = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return Capacitor.isNativePlatform() || MOBILE_DEVICE_REGEX.test(window.navigator.userAgent);
};

export const handleOpenNavigator = ({
  lat,
  lon,
  address,
  label,
}: NavigatorTarget) => {
  const normalizedAddress = address?.trim();
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);

  if (hasCoordinates) {
    if (isMobileNavigatorPlatform()) {
      const geoLabel = label?.trim()
        ? `?q=${lat},${lon}(${encodeURIComponent(label.trim())})`
        : "";
      window.location.href = `geo:${lat},${lon}${geoLabel}`;
      return true;
    }

    window.open(`https://2gis.ru/geo/${lon},${lat}`, "_blank", "noopener,noreferrer");
    return true;
  }

  if (normalizedAddress) {
    if (isMobileNavigatorPlatform()) {
      window.location.href = `geo:0,0?q=${encodeURIComponent(normalizedAddress)}`;
      return true;
    }

    window.open(
      `https://2gis.ru/routeSearch/rsType/car/to/${encodeURIComponent(normalizedAddress)}`,
      "_blank",
      "noopener,noreferrer",
    );
    return true;
  }

  return false;
};
