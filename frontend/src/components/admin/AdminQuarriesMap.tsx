import { useEffect, useRef, useState } from "react";

import MapWebGLFallback, {
  load2GisMapSdk,
  tryCreate2GisMap,
} from "../MapWebGLFallback";

export interface AdminMapPoint {
  id?: string;
  name: string;
  lat: number | null;
  lon: number | null;
  crm_status?: "parsed" | "active" | "rejected";
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

const createMarkerElement = (point: AdminMapPoint, onClick: () => void) => {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.title = point.name;
  marker.setAttribute("aria-label", `Открыть точку: ${point.name}`);
  marker.style.width = "30px";
  marker.style.height = "30px";
  marker.style.borderRadius = "9999px";
  marker.style.border = "3px solid white";
  marker.style.backgroundColor = point.crm_status === "active" ? "#16a34a" : "#64748b";
  marker.style.boxShadow = "0 2px 8px rgba(15, 23, 42, 0.35)";
  marker.style.cursor = "pointer";
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return marker;
};

export default function AdminQuarriesMap({
  points,
  center,
  onPointClick,
}: AdminQuarriesMapProps) {
  const [isMapReady, setIsMapReady] = useState(false);
  const [isMapUnavailable, setIsMapUnavailable] = useState(false);
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
    markerRefs.current = points.filter(isRenderablePoint).map((point) => {
      const element = createMarkerElement(point, () => onPointClickRef.current(point));
      return new mapgl.HtmlMarker(mapRef.current, {
        coordinates: [point.lon, point.lat],
        html: element,
      });
    });
  }, [isMapReady, points]);

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
