import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { useAdminModerationStore, useAuthStore } from "../../store";
import { baseURL } from "../../utils";

interface InboxNotification {
  id: string;
  event_type: string;
  title: string;
  body: string;
}

const MODERATION_EVENTS = new Set([
  "water_point_created",
  "water_point_updated",
  "pickup_point_pending_moderation",
  "equipment_listing_pending_moderation",
]);

export default function AdminNotificationToastListener() {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const registerModerationNotification = useAdminModerationStore(
    (state) => state.registerNotification,
  );
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(false);

  useEffect(() => {
    seenNotificationIdsRef.current.clear();
    isInitialLoadRef.current = false;

    if (!token || (role !== "admin" && role !== "logist")) return;

    let isActive = true;

    const showNotificationToast = (notifications: InboxNotification[]) => {
      if (notifications.length === 0) return;

      const newestModerationNotification = notifications.find((item) =>
        MODERATION_EVENTS.has(item.event_type),
      );
      if (newestModerationNotification) {
        registerModerationNotification({
          event: newestModerationNotification.event_type,
          title: newestModerationNotification.title,
          body: newestModerationNotification.body,
        });
      }

      const newestNotification = notifications[0];
      toast(
        newestModerationNotification
          ? "Есть новые заявки на модерацию"
          : newestNotification.title || "Есть новые уведомления",
        {
          id: "admin-unread-notifications",
          duration: 6000,
          position: "top-center",
          icon: "🔔",
          style: { background: "#0f172a", color: "#ffffff", fontWeight: "700" },
        },
      );
    };

    const loadUnreadNotifications = async () => {
      try {
        const response = await fetch(`${baseURL}/notifications?unread_only=true&limit=100`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => []);
        if (!response.ok || !isActive || !Array.isArray(data)) return;

        const unreadNotifications = data as InboxNotification[];
        const currentIds = new Set(unreadNotifications.map((item) => item.id));

        if (!isInitialLoadRef.current) {
          seenNotificationIdsRef.current = currentIds;
          isInitialLoadRef.current = true;
          showNotificationToast(unreadNotifications);
          return;
        }

        const newNotifications = unreadNotifications.filter(
          (item) => !seenNotificationIdsRef.current.has(item.id),
        );
        seenNotificationIdsRef.current = currentIds;

        if (newNotifications.length === 0) return;

        showNotificationToast(newNotifications);
      } catch {
        // Ошибки фонового polling не должны прерывать работу панели администратора.
      }
    };

    void loadUnreadNotifications();
    const intervalId = window.setInterval(() => void loadUnreadNotifications(), 30000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [registerModerationNotification, role, token]);

  return null;
}
