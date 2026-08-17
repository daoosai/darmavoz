import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import { Geolocation } from "@capacitor/geolocation";

import { baseURL } from "./utils";

const LOCATION_INTERVAL_MS = 30 * 1000;
const GPS_POSITION_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 20_000,
} as const;
const FALLBACK_POSITION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 30_000,
  timeout: 20_000,
} as const;

type TrackingState = "idle" | "tracking" | "permission_denied" | "error";

interface UseDriverLocationTrackingParams {
  isOnShift: boolean;
  token: string | null;
}

const isLocationGranted = (permissions: Awaited<ReturnType<typeof Geolocation.checkPermissions>>) =>
  permissions.location === "granted" || permissions.coarseLocation === "granted";

export function useDriverLocationTracking({
  isOnShift,
  token,
}: UseDriverLocationTrackingParams) {
  const intervalRef = useRef<number | null>(null);
  const backgroundTrackingActiveRef = useRef(false);
  const isTrackingEnabledRef = useRef(false);
  const isSendingRef = useRef(false);
  const lastBackgroundSendAtRef = useRef(0);
  const [trackingState, setTrackingState] = useState<TrackingState>("idle");

  const stopTracking = useCallback(async () => {
    isTrackingEnabledRef.current = false;
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    lastBackgroundSendAtRef.current = 0;
    if (backgroundTrackingActiveRef.current) {
      backgroundTrackingActiveRef.current = false;
      try {
        await BackgroundGeolocation.stop();
      } catch (error) {
        console.warn("Не удалось остановить фоновую геолокацию", error);
      }
    }
  }, []);

  const sendLocationCoordinates = useCallback(async (lat: number, lon: number) => {
    if (!isTrackingEnabledRef.current || !isOnShift || !token || isSendingRef.current) return;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      console.warn("Получены некорректные координаты водителя");
      return;
    }

    isSendingRef.current = true;
    try {
      const response = await fetch(`${baseURL}/driver/location`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lat, lon }),
      });

      if (!response.ok) {
        throw new Error("Не удалось передать геопозицию");
      }

      setTrackingState("tracking");
    } catch (error) {
      console.warn("Не удалось передать геопозицию водителя", error);
      setTrackingState("error");
    } finally {
      isSendingRef.current = false;
    }
  }, [isOnShift, token]);

  const ensureLocationPermission = useCallback(async () => {
    let permissions = await Geolocation.checkPermissions();
    if (!isLocationGranted(permissions)) {
      permissions = await Geolocation.requestPermissions({ permissions: ["location"] });
    }

    if (!isLocationGranted(permissions)) {
      setTrackingState("permission_denied");
      return false;
    }

    return true;
  }, []);

  const getForegroundPosition = useCallback(async () => {
    try {
      return await Geolocation.getCurrentPosition(GPS_POSITION_OPTIONS);
    } catch (error) {
      console.warn("Не удалось получить точную GPS-геопозицию, используем резервный источник", error);
      return Geolocation.getCurrentPosition(FALLBACK_POSITION_OPTIONS);
    }
  }, []);

  const sendForegroundLocation = useCallback(async () => {
    if (!isOnShift || !token) return;

    try {
      if (!await ensureLocationPermission()) return;

      const position = await getForegroundPosition();
      await sendLocationCoordinates(position.coords.latitude, position.coords.longitude);
    } catch (error) {
      console.warn("Не удалось получить геопозицию водителя", error);
      setTrackingState("error");
    }
  }, [ensureLocationPermission, getForegroundPosition, isOnShift, sendLocationCoordinates, token]);

  const startForegroundTracking = useCallback(() => {
    if (!isTrackingEnabledRef.current || intervalRef.current != null) return;

    void sendForegroundLocation();
    intervalRef.current = window.setInterval(
      () => void sendForegroundLocation(),
      LOCATION_INTERVAL_MS,
    );
  }, [sendForegroundLocation]);

  const startBackgroundTracking = useCallback(async () => {
    if (backgroundTrackingActiveRef.current) return;

    try {
      if (!await ensureLocationPermission() || !isTrackingEnabledRef.current) return;

      // Получаем первую позицию до запуска watcher: fallback поможет в помещении,
      // а дальше нативный watcher будет единственным источником обновлений.
      await sendForegroundLocation();
      if (!isTrackingEnabledRef.current) return;

      const startPromise = BackgroundGeolocation.start(
        {
          backgroundTitle: "Геопозиция Дармавоз",
          backgroundMessage: "Передаём ваше местоположение логисту",
          requestPermissions: false,
          stale: false,
          distanceFilter: 0,
          minIntervalMs: LOCATION_INTERVAL_MS,
        },
        (location, error) => {
          if (error) {
            console.warn("Ошибка фоновой геолокации", error);
            setTrackingState(error.code === "PERMISSION_DENIED" ? "permission_denied" : "error");
            return;
          }
          if (!location) return;

          const now = Date.now();
          if (now - lastBackgroundSendAtRef.current < LOCATION_INTERVAL_MS) return;
          lastBackgroundSendAtRef.current = now;
          void sendLocationCoordinates(location.latitude, location.longitude);
        },
      );
      backgroundTrackingActiveRef.current = true;
      void startPromise.catch((error) => {
        backgroundTrackingActiveRef.current = false;
        console.warn("Не удалось запустить фоновую геолокацию", error);
        if (isTrackingEnabledRef.current) startForegroundTracking();
      });
    } catch (error) {
      console.warn("Не удалось запустить фоновую геолокацию", error);
      if (isTrackingEnabledRef.current) startForegroundTracking();
    }
  }, [ensureLocationPermission, sendForegroundLocation, sendLocationCoordinates, startForegroundTracking]);

  const startTracking = useCallback(() => {
    if (!isOnShift || !token) return;

    if (Capacitor.isNativePlatform()) {
      void startBackgroundTracking();
      return;
    }

    startForegroundTracking();
  }, [isOnShift, startBackgroundTracking, startForegroundTracking, token]);

  useEffect(() => {
    isTrackingEnabledRef.current = isOnShift && Boolean(token);
    if (isOnShift && token) {
      startTracking();
      return;
    }

    void stopTracking();
    setTrackingState("idle");
  }, [isOnShift, startTracking, stopTracking, token]);

  useEffect(() => () => {
    void stopTracking();
  }, [stopTracking]);

  return { trackingState };
}
