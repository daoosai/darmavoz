import { useEffect, useRef, useState } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { useAuthStore } from './store';
import { baseURL } from './utils';
import toast from 'react-hot-toast';
import { Capacitor } from '@capacitor/core';
import {
  messaging,
  onMessage,
} from './services/firebase';
import { getWebPushTokenWithRetry } from './services/webPush';
import {
  getPushTokenEndpoint,
  isPushEnabledForRole,
  PUSH_SETTINGS_CHANGED_EVENT,
} from './pushAuth';

const saveFcmToken = async (endpoint: string, authToken: string, fcmToken: string) => {
  const response = await fetch(`${baseURL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ token: fcmToken }),
  });

  if (!response.ok) {
    throw new Error(`FCM token save failed: ${response.status}`);
  }
};

export const usePushNotifications = () => {
  const { token, role } = useAuthStore();
  const [isPushEnabled, setIsPushEnabled] = useState<boolean>(() =>
    isPushEnabledForRole(useAuthStore.getState().role),
  );
  const notificationSoundRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const audio = new Audio('/notification.mp3');
    audio.preload = 'auto';

    const switchToFallbackSound = () => {
      if (audio.src.endsWith('/new_order.mp3')) {
        return;
      }

      console.warn('notification.mp3 is unavailable, falling back to /new_order.mp3');
      audio.src = '/new_order.mp3';
      audio.load();
    };

    audio.addEventListener('error', switchToFallbackSound);
    audio.load();
    notificationSoundRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('error', switchToFallbackSound);
      notificationSoundRef.current = null;
    };
  }, []);

  const playNotificationSound = () => {
    const notificationSound = notificationSoundRef.current;

    if (!notificationSound) {
      return;
    }

    notificationSound.currentTime = 0;

    notificationSound
      .play()
      .then(() => {
        console.log('Sound played successfully');
      })
      .catch((err) => {
        console.error('Audio autoplay blocked by browser:', err);
        notificationSound.muted = false;

        notificationSound.play().catch((retryError) => {
          console.error('Retry failed:', retryError);

          if (!notificationSound.src.endsWith('/new_order.mp3')) {
            notificationSound.src = '/new_order.mp3';
            notificationSound.load();
            notificationSound.play().catch((fallbackError) => {
              console.error('Fallback sound failed:', fallbackError);
            });
          }
        });
      });
  };

  const handleForegroundPush = (title?: string, body?: string) => {
    const safeTitle = title || 'Новое уведомление';
    const safeBody = body || 'Обновите список заказов';
    playNotificationSound();

    toast.success(`${safeTitle}\n${safeBody}`, {
      duration: 6000,
      position: 'top-center',
      style: {
        fontSize: '16px',
        fontWeight: 'bold',
      },
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('refresh_orders'));
    }
  };

  useEffect(() => {
    setIsPushEnabled(isPushEnabledForRole(role));

    if (typeof window === 'undefined') {
      return;
    }

    const syncPushState = () => {
      setIsPushEnabled(isPushEnabledForRole(role));
    };

    const handlePushSettingsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ role?: string }>;
      if (!customEvent.detail?.role || customEvent.detail.role === role) {
        syncPushState();
      }
    };

    window.addEventListener(PUSH_SETTINGS_CHANGED_EVENT, handlePushSettingsChanged as EventListener);
    window.addEventListener('storage', syncPushState);

    return () => {
      window.removeEventListener(PUSH_SETTINGS_CHANGED_EVENT, handlePushSettingsChanged as EventListener);
      window.removeEventListener('storage', syncPushState);
    };
  }, [role]);

  useEffect(() => {
    let isMounted = true;
    let webUnsubscribe: (() => void) | undefined;

    const endpoint = getPushTokenEndpoint(role);

    const setupNativePushNotifications = async () => {
      if (!token || !endpoint || !isPushEnabled) return;

      try {
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.warn('Push notification permissions not granted');
          return;
        }

        await PushNotifications.register();

        PushNotifications.addListener('registration', async (capacitorToken) => {
          if (!isMounted) return;
          try {
            await saveFcmToken(endpoint, token, capacitorToken.value);
            console.log('FCM token sent to backend (Native)');
          } catch (error) {
            console.error('Failed to send FCM token to backend (Native)', error);
          }
        });

        PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error on registration: ' + JSON.stringify(error));
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          if (!isMounted) return;
          console.log('Foreground push received:', notification);
          handleForegroundPush(notification.title, notification.body);
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          console.log('Push action performed: ' + JSON.stringify(notification));
        });
      } catch (error) {
        console.error('Push notification setup failed', error);
      }
    };

    const setupWebPushNotifications = async () => {
      if (!token || !endpoint || !messaging || !isPushEnabled) return;

      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.warn('Web push notification permissions not granted');
          return;
        }

        const currentToken = await getWebPushTokenWithRetry();

        if (currentToken) {
          await saveFcmToken(endpoint, token, currentToken);
          console.log('FCM token sent to backend (Web)');
        } else {
          console.error('FCM token is empty for web push; backend registration skipped');
          return;
        }

        webUnsubscribe = onMessage(messaging, (payload) => {
          if (!isMounted) return;
          console.log('Foreground push received:', payload);
          if (Notification.permission === 'granted') {
            try {
              new Notification(payload.notification?.title || 'Новое уведомление', {
                body: payload.notification?.body || '',
              });
            } catch {
              // ignore system notification errors in foreground
            }
          }
          handleForegroundPush(payload.notification?.title, payload.notification?.body);
        });
      } catch (err) {
        console.error('Web push notification setup failed', err);
      }
    };

    if (token && isPushEnabled) {
      if (Capacitor.isNativePlatform()) {
        setupNativePushNotifications();
      } else {
        setupWebPushNotifications();
      }
    }

    return () => {
      isMounted = false;
      if (Capacitor.isNativePlatform()) {
        try {
          PushNotifications.removeAllListeners();
        } catch {
          // ignore listener cleanup errors
        }
      }
      if (webUnsubscribe) {
        webUnsubscribe();
      }
    };
  }, [token, role, isPushEnabled]);
};
