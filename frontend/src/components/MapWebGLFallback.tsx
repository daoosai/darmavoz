const WEBGL_FALLBACK_TEXT =
  "Для отображения карты требуется поддержка WebGL. Пожалуйста, воспользуйтесь отображением списком.";

let mapglLoadPromise: Promise<any> | null = null;

export const load2GisMapSdk = (): Promise<any> => {
  if ((window as any).mapgl) return Promise.resolve((window as any).mapgl);
  if (mapglLoadPromise) return mapglLoadPromise;

  const script = document.querySelector<HTMLScriptElement>(
    'script[src*="mapgl.2gis.com/api/js"]',
  );
  if (!script) return Promise.reject(new Error("2GIS MapGL script tag is missing"));

  mapglLoadPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("2GIS MapGL SDK loading timed out")),
      15000,
    );
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      const mapgl = (window as any).mapgl;
      if (mapgl) resolve(mapgl);
      else reject(new Error("2GIS MapGL SDK did not expose window.mapgl"));
    };
    const handleError = () => {
      cleanup();
      reject(new Error("2GIS MapGL SDK failed to load"));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
  });
  return mapglLoadPromise;
};

const supportsWebGL = () => {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    return false;
  }
};

export const tryCreate2GisMap = <T,>(
  createMap: () => T,
  onUnavailable: () => void,
): T | null => {
  try {
    if (!supportsWebGL()) throw new Error("WebGL is not supported");
    return createMap();
  } catch (error) {
    console.error("Не удалось инициализировать карту 2ГИС", error);
    onUnavailable();
    return null;
  }
};

export default function MapWebGLFallback({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      className={`grid place-items-center bg-slate-100 p-6 text-center text-sm font-semibold text-slate-600 ${className}`}
    >
      <p className="max-w-md">{WEBGL_FALLBACK_TEXT}</p>
    </div>
  );
}
