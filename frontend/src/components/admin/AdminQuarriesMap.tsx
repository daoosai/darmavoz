import { useEffect, useRef, useState } from "react";

import MapWebGLFallback, {
  load2GisMapSdk,
  tryCreate2GisMap,
} from "../MapWebGLFallback";

export interface AdminMapPoint {
  id?: string;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  twogis_id?: string | null;
  is_active: boolean;
  crm_status?: "parsed" | "in_progress" | "agreed" | "hidden";
}

interface AdminQuarriesMapProps {
  points: AdminMapPoint[];
  center: { lat: number; lon: number };
  onPointClick: (point: AdminMapPoint) => void;
}

const isRenderablePoint = (
  point: AdminMapPoint,
): point is AdminMapPoint & { lat: number; lon: number } =>
  typeof point.lat === "number" &&
  Number.isFinite(point.lat) &&
  typeof point.lon === "number" &&
  Number.isFinite(point.lon);

const getPointKey = (point: AdminMapPoint) =>
  point.id ?? `${point.name}:${point.lat}:${point.lon}`;

const createDetailRow = (label: string, value: string) => {
  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "64px minmax(0, 1fr)";
  row.style.gap = "8px";
  row.style.alignItems = "start";

  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  labelElement.style.color = "#64748b";
  labelElement.style.fontSize = "11px";
  labelElement.style.fontWeight = "700";

  const valueElement = document.createElement("span");
  valueElement.textContent = value;
  valueElement.style.minWidth = "0";
  valueElement.style.overflow = "hidden";
  valueElement.style.textOverflow = "ellipsis";
  valueElement.style.whiteSpace = "nowrap";
  valueElement.style.color = "#1e293b";
  valueElement.style.fontSize = "12px";
  valueElement.style.fontWeight = "600";

  row.append(labelElement, valueElement);
  return row;
};

const createMarkerElement = (
  point: AdminMapPoint,
  isSelected: boolean,
  onSelect: () => void,
  onClose: () => void,
  onEdit: () => void,
) => {
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.width = "30px";
  wrapper.style.height = "30px";
  wrapper.style.zIndex = isSelected ? "9999" : "1";

  const marker = document.createElement("button");
  marker.type = "button";
  marker.title = point.name;
  marker.setAttribute("aria-label", `Открыть точку: ${point.name}`);
  marker.style.width = "30px";
  marker.style.height = "30px";
  marker.style.borderRadius = "9999px";
  marker.style.border = "3px solid white";
  marker.style.backgroundColor = point.crm_status === "parsed"
    ? "#facc15"
    : point.crm_status === "in_progress"
      ? "#94a3b8"
      : point.crm_status === "agreed"
        ? "#16a34a"
        : "#475569";
  marker.style.boxShadow = "0 2px 8px rgba(15, 23, 42, 0.35)";
  marker.style.cursor = "pointer";
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    onSelect();
  });
  wrapper.appendChild(marker);

  if (isSelected) {
    const card = document.createElement("div");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `Превью точки: ${point.name}`);
    card.style.position = "absolute";
    card.style.left = "50%";
    card.style.bottom = "42px";
    card.style.transform = "translateX(-50%)";
    card.style.zIndex = "9999";
    card.style.width = "280px";
    card.style.maxWidth = "calc(100vw - 32px)";
    card.style.padding = "14px";
    card.style.border = "1px solid #e2e8f0";
    card.style.borderRadius = "16px";
    card.style.background = "white";
    card.style.boxShadow = "0 12px 30px rgba(15, 23, 42, 0.2)";
    card.style.fontFamily = "inherit";
    card.addEventListener("click", (event) => event.stopPropagation());

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "start";
    header.style.justifyContent = "space-between";
    header.style.gap = "8px";

    const title = document.createElement("div");
    title.textContent = point.name;
    title.style.minWidth = "0";
    title.style.overflow = "hidden";
    title.style.textOverflow = "ellipsis";
    title.style.whiteSpace = "nowrap";
    title.style.color = "#0f172a";
    title.style.fontSize = "14px";
    title.style.fontWeight = "800";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.title = "Закрыть превью";
    closeButton.setAttribute("aria-label", "Закрыть превью");
    closeButton.style.flexShrink = "0";
    closeButton.style.width = "24px";
    closeButton.style.height = "24px";
    closeButton.style.border = "0";
    closeButton.style.borderRadius = "9999px";
    closeButton.style.background = "#f1f5f9";
    closeButton.style.color = "#64748b";
    closeButton.style.fontSize = "18px";
    closeButton.style.lineHeight = "1";
    closeButton.style.cursor = "pointer";
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose();
    });
    header.append(title, closeButton);
    card.appendChild(header);

    const details = document.createElement("div");
    details.style.display = "grid";
    details.style.gap = "7px";
    details.style.marginTop = "12px";
    details.append(
      createDetailRow("Адрес", point.address?.trim() || "Адрес не указан"),
      createDetailRow("Источник", point.twogis_id ? "2ГИС" : "Ручной"),
      createDetailRow("Владелец", point.owner_name?.trim() || "Не привязан"),
    );
    card.appendChild(details);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "✏️ Редактировать";
    editButton.setAttribute("aria-label", `Редактировать точку: ${point.name}`);
    editButton.style.width = "100%";
    editButton.style.marginTop = "12px";
    editButton.style.padding = "9px 12px";
    editButton.style.border = "0";
    editButton.style.borderRadius = "10px";
    editButton.style.background = "#e0f2fe";
    editButton.style.color = "#0369a1";
    editButton.style.fontSize = "12px";
    editButton.style.fontWeight = "800";
    editButton.style.cursor = "pointer";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onEdit();
    });
    card.appendChild(editButton);
    wrapper.appendChild(card);
  }

  return wrapper;
};

export default function AdminQuarriesMap({
  points,
  center,
  onPointClick,
}: AdminQuarriesMapProps) {
  const [isMapReady, setIsMapReady] = useState(false);
  const [isMapUnavailable, setIsMapUnavailable] = useState(false);
  const [selectedPointKey, setSelectedPointKey] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const onPointClickRef = useRef(onPointClick);
  onPointClickRef.current = onPointClick;

  useEffect(() => {
    let disposed = false;
    const key = import.meta.env.VITE_2GIS_KEY;

    if (!key || !mapContainerRef.current) {
      setIsMapUnavailable(true);
      return;
    }

    void load2GisMapSdk()
      .then((mapgl) => {
        if (disposed || !mapContainerRef.current || mapRef.current) return;
        const mapInstance = tryCreate2GisMap(
          () =>
            new mapgl.Map(mapContainerRef.current, {
              center: [center.lon, center.lat],
              zoom: 10,
              key,
            }),
          () => setIsMapUnavailable(true),
        );
        if (!mapInstance) return;
        if (disposed) {
          mapInstance.destroy();
          return;
        }
        mapRef.current = mapInstance;
        setIsMapReady(true);
      })
      .catch(() => {
        if (!disposed) setIsMapUnavailable(true);
      });

    return () => {
      disposed = true;
      markerRefs.current.forEach((marker) => marker.destroy?.());
      markerRefs.current = [];
      mapRef.current?.destroy?.();
      mapRef.current = null;
      setIsMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;
    mapRef.current.setCenter([center.lon, center.lat], {
      easing: "easeOutCubic",
      duration: 700,
    });
  }, [center.lat, center.lon, isMapReady]);

  useEffect(() => {
    const mapgl = (window as any).mapgl;
    if (!isMapReady || !mapRef.current || !mapgl?.HtmlMarker) return;

    markerRefs.current.forEach((marker) => marker.destroy?.());
    markerRefs.current = points.filter((point) => point.crm_status !== "hidden").filter(isRenderablePoint).map((point) => {
      const pointKey = getPointKey(point);
      const element = createMarkerElement(
        point,
        pointKey === selectedPointKey,
        () => {
          const map = mapRef.current;
          const center: [number, number] = [point.lon, point.lat];
          if (typeof map?.flyTo === "function") {
            map.flyTo({ center, zoom: 14, duration: 400 });
          } else if (map) {
            map.setCenter(center, { easing: "easeOutCubic", duration: 400 });
            if (typeof map.setZoom === "function") {
              map.setZoom(14, { easing: "easeOutCubic", duration: 400 });
            }
          }
          setSelectedPointKey((current) => (current === pointKey ? null : pointKey));
        },
        () => setSelectedPointKey(null),
        () => {
          setSelectedPointKey(null);
          onPointClickRef.current(point);
        },
      );
      return new mapgl.HtmlMarker(mapRef.current, {
        coordinates: [point.lon, point.lat],
        html: element,
      });
    });
  }, [isMapReady, points, selectedPointKey]);

  if (isMapUnavailable) {
    return <MapWebGLFallback className="h-[420px] min-h-[360px] w-full rounded-2xl" />;
  }

  return (
    <div
      ref={mapContainerRef}
      aria-label="Карта точек"
      className="h-[420px] min-h-[360px] w-full overflow-hidden rounded-2xl bg-slate-200"
    />
  );
}
