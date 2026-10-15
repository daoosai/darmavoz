export type MapFailureReason = "webgl" | "sdk" | "initialization" | "configuration";

export class MapUnavailableError extends Error {
  constructor(public readonly reason: MapFailureReason, message: string) {
    super(message);
    this.name = "MapUnavailableError";
  }
}

let mapglLoadPromise: Promise<any> | null = null;

export const load2GisMapSdk = (): Promise<any> => {
  if ((window as any).mapgl) return Promise.resolve((window as any).mapgl);
  if (mapglLoadPromise) return mapglLoadPromise;

  // The initial HTML script may already have failed before React mounted.
  // Start a fresh request; never cache a rejected load for the entire session.
  const existing = document.querySelector<HTMLScriptElement>('script[src*="mapgl.2gis.com/api/js"]');
  const script = document.createElement("script");
  script.src = existing?.src || "https://mapgl.2gis.com/api/js/v1";
  script.async = true;
  existing?.remove();

  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
    const fail = (message: string) => {
      cleanup();
      script.remove();
      reject(new MapUnavailableError("sdk", message));
    };
    const handleLoad = () => {
      cleanup();
      const mapgl = (window as any).mapgl;
      if (mapgl) resolve(mapgl);
      else fail("2GIS MapGL SDK did not expose window.mapgl");
    };
    const handleError = () => fail("2GIS MapGL SDK failed to load");
    const timeout = window.setTimeout(() => fail("2GIS MapGL SDK loading timed out"), 15000);
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });
  mapglLoadPromise = promise.catch((error) => {
    mapglLoadPromise = null;
    throw error;
  });
  return mapglLoadPromise;
};

const supportsWebGL = () => {
  const sdk = (window as any).mapgl;
  if (typeof sdk?.isSupported === "function") return sdk.isSupported();
  // Compatibility with older SDKs and test stubs.
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement("canvas");
    gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return Boolean(gl && !gl.isContextLost());
  } catch {
    return false;
  } finally {
    // Probe contexts must not consume GPU resources after repeated map visits.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
};

export const tryCreate2GisMap = <T,>(
  createMap: () => T,
  onUnavailable: (error: MapUnavailableError) => void,
): T | null => {
  try {
    if (!supportsWebGL()) throw new MapUnavailableError("webgl", "WebGL is not supported");
    return createMap();
  } catch (error) {
    const failure = error instanceof MapUnavailableError
      ? error
      : new MapUnavailableError("initialization", error instanceof Error ? error.message : "Map initialization failed");
    console.error("Не удалось инициализировать карту 2ГИС", failure);
    onUnavailable(failure);
    return null;
  }
};

const FAILURE_TEXT: Record<MapFailureReason, string> = {
  webgl: "В этом браузере недоступен WebGL — карта не может отобразиться. Попробуйте другой браузер.",
  sdk: "Не удалось загрузить карту 2ГИС. Проверьте соединение и повторите загрузку.",
  initialization: "Не удалось открыть карту. Попробуйте загрузить её ещё раз.",
  configuration: "Карта временно недоступна. Обратитесь в поддержку.",
};

export default function MapWebGLFallback({
  className = "",
  reason = "initialization",
  onRetry,
}: {
  className?: string;
  reason?: MapFailureReason;
  onRetry?: () => void;
}) {
  return (
    <div role="status" className={`grid place-items-center bg-slate-100 p-6 text-center text-sm font-semibold text-slate-600 ${className}`}>
      <div className="max-w-md">
        <p>{FAILURE_TEXT[reason]}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-sky-500 px-4 py-3 font-bold text-white">
            Повторить загрузку
          </button>
        ) : null}
      </div>
    </div>
  );
}
