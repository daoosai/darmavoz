const WEBGL_FALLBACK_TEXT =
  "Для отображения карты требуется поддержка WebGL. Пожалуйста, воспользуйтесь отображением списком.";

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
