import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

import { baseURL } from "./utils";

const LOCATION_INTERVAL_MS = 15 * 1000;

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
  const isAppActiveRef = useRef(true);
  const isSendingRef = useRef(false);
  const [trackingState, setTrackingState] = useState<TrackingState>("idle");

  const stopTracking = useCallback(() => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const sendLocation = useCallback(async () => {
    if (!isOnShift || !token || !isAppActiveRef.current || isSendingRef.current) return;

    isSendingRef.current = true;
    try {
      let permissions = await Geolocation.checkPermissions();
      if (!isLocationGranted(permissions)) {
        permissions = await Geolocation.requestPermissions();
      }

      if (!isLocationGranted(permissions)) {
        setTrackingState("permission_denied");
        stopTracking();
        return;
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 10_000,
      });
      const response = await fetch(`${baseURL}/driver/location`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        }),
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
  }, [isOnShift, stopTracking, token]);

  const startTracking = useCallback(() => {
    stopTracking();
    if (!isOnShift || !token || !isAppActiveRef.current) return;

    void sendLocation();
    intervalRef.current = window.setInterval(() => void sendLocation(), LOCATION_INTERVAL_MS);
  }, [isOnShift, sendLocation, stopTracking, token]);

  useEffect(() => {
    if (isOnShift && token && isAppActiveRef.current) {
      startTracking();
    } else {
      stopTracking();
      setTrackingState("idle");
    }

    return stopTracking;
  }, [isOnShift, startTracking, stopTracking, token]);

  useEffect(() => {
    let isDisposed = false;
    let listener: PluginListenerHandle | undefined;

    void App.addListener("appStateChange", ({ isActive }) => {
      isAppActiveRef.current = isActive;
      if (!isActive) {
        stopTracking();
        return;
      }

      if (isOnShift && token) {
        startTracking();
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
      stopTracking();
      void listener?.remove();
    };
  }, [isOnShift, startTracking, stopTracking, token]);

  return { trackingState };
}
