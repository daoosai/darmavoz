import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import { Geolocation } from "@capacitor/geolocation";

import { baseURL } from "./utils";

const LOCATION_INTERVAL_MS = 30 * 1000;

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
  const isSendingRef = useRef(false);
  const lastBackgroundSendAtRef = useRef(0);
  const [trackingState, setTrackingState] = useState<TrackingState>("idle");

  const stopTracking = useCallback(async () => {
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
    if (!isOnShift || !token || isSendingRef.current) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

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

  const sendForegroundLocation = useCallback(async () => {
    if (!isOnShift || !token) return;

    try {
      let permissions = await Geolocation.checkPermissions();
      if (!isLocationGranted(permissions)) {
        permissions = await Geolocation.requestPermissions();
      }

      if (!isLocationGranted(permissions)) {
        setTrackingState("permission_denied");
        return;
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 10_000,
      });
      await sendLocationCoordinates(position.coords.latitude, position.coords.longitude);
    } catch (error) {
      console.warn("Не удалось получить геопозицию водителя", error);
      setTrackingState("error");
    }
  }, [isOnShift, sendLocationCoordinates, token]);

  const startForegroundTracking = useCallback(() => {
    if (intervalRef.current != null) return;

    void sendForegroundLocation();
    intervalRef.current = window.setInterval(
      () => void sendForegroundLocation(),
      LOCATION_INTERVAL_MS,
    );
  }, [sendForegroundLocation]);

  const startBackgroundTracking = useCallback(async () => {
    if (backgroundTrackingActiveRef.current) return;

    try {
      await BackgroundGeolocation.start(
        {
          backgroundTitle: "Геопозиция Дармавоз",
          backgroundMessage: "Передаём ваше местоположение логисту",
          requestPermissions: true,
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
      void sendForegroundLocation();
    } catch (error) {
      console.warn("Не удалось запустить фоновую геолокацию", error);
      startForegroundTracking();
    }
  }, [sendForegroundLocation, sendLocationCoordinates, startForegroundTracking]);

  const startTracking = useCallback(() => {
    if (!isOnShift || !token) return;

    if (Capacitor.isNativePlatform()) {
      void startBackgroundTracking();
      return;
    }

    startForegroundTracking();
  }, [isOnShift, startBackgroundTracking, startForegroundTracking, token]);

  useEffect(() => {
    if (isOnShift && token) {
      startTracking();
      return;
    }

    void stopTracking();
    setTrackingState("idle");
  }, [isOnShift, startTracking, stopTracking, token]);

  useEffect(() => {
    let isDisposed = false;
    let listener: PluginListenerHandle | undefined;

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive && isOnShift && token) {
        void sendForegroundLocation();
      }
    })
      .then((handle) => {
        if (isDisposed) {
          void handle.remove();
          return;
        }
        listener = handle;
      })
      .catch((error) => console.warn("Не удалось подписаться на состояние приложения", error));

    return () => {
      isDisposed = true;
      void listener?.remove();
    };
  }, [isOnShift, sendForegroundLocation, token]);

  useEffect(() => () => {
    void stopTracking();
  }, [stopTracking]);

  return { trackingState };
}
