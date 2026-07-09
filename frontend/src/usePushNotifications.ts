import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { useAuthStore } from './store';
import { baseURL } from './utils';
import toast from 'react-hot-toast';
import { Capacitor } from '@capacitor/core';
import {
  FIREBASE_WEB_VAPID_KEY,
  getToken,
  messaging,
  onMessage,
} from './services/firebase';
import { getPushTokenEndpoint, isPushEnabledForRole } from './pushAuth';

const saveFcmToken = async (endpoint: string, authToken: string, fcmToken: string) => {
  await fetch(`${baseURL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ token: fcmToken }),
  });
};

export const usePushNotifications = () => {
  const { token, role } = useAuthStore();

  useEffect(() => {
    let isMounted = true;
    let webUnsubscribe: (() => void) | undefined;

    const endpoint = getPushTokenEndpoint(role);
    const isPushEnabled = isPushEnabledForRole(role);

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
          if (!isMounted || !notification.title) return;
          toast.info(`🔔 ${notification.title}
${notification.body || ''}`, {
            duration: 5000,
          });
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

        const serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const currentToken = await getToken(messaging, {
          vapidKey: FIREBASE_WEB_VAPID_KEY,
          serviceWorkerRegistration,
        });

        if (currentToken) {
          await saveFcmToken(endpoint, token, currentToken);
          console.log('FCM token sent to backend (Web)');
        } else {
          console.warn('FCM token is empty for web push');
        }

        webUnsubscribe = onMessage(messaging, (payload) => {
          if (!isMounted || !payload.notification) return;
          if (Notification.permission === 'granted') {
            try {
              new Notification(payload.notification.title || 'Новое уведомление', {
                body: payload.notification.body || '',
              });
            } catch {
              // ignore system notification errors in foreground
            }
          }
          toast.info(`🔔 ${payload.notification.title}
${payload.notification.body || ''}`, {
            duration: 5000,
          });
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
  }, [token, role]);
};
