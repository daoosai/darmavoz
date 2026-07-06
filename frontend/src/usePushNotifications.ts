import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { useAuthStore } from './store';
import { baseURL } from './utils';
import toast from 'react-hot-toast';
import { Capacitor } from '@capacitor/core';
import { firebaseMessagingConfig, firebaseVapidKey, messaging, getToken, onMessage } from './services/firebase';

const resolveFcmEndpoint = (role: string | null | undefined) => {
  if (role === 'client') return '/clients/me/fcm-token';
  if (role === 'driver') return '/driver/fcm-token';
  if (role === 'logist' || role === 'admin') return '/logist/me/fcm-token';
  return null;
};

const buildServiceWorkerUrl = () => {
  const params = new URLSearchParams(firebaseMessagingConfig as Record<string, string>);
  return `/firebase-messaging-sw.js?${params.toString()}`;
};

export const usePushNotifications = () => {
  const { token, role } = useAuthStore();

  useEffect(() => {
    let isMounted = true;
    let webUnsubscribe: (() => void) | undefined;

    const setupNativePushNotifications = async () => {
      if (!token) return;
      const endpoint = resolveFcmEndpoint(role);
      if (!endpoint) return;

      try {
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }
        if (permStatus.receive !== 'granted') {
          return;
        }

        await PushNotifications.register();

        PushNotifications.addListener('registration', async (capacitorToken) => {
          if (!isMounted) return;
          try {
            await fetch(`${baseURL}${endpoint}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ token: capacitorToken.value }),
            });
          } catch (error) {
            console.error('Failed to send FCM token to backend (Native)', error);
          }
        });

        PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error on registration: ' + JSON.stringify(error));
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          if (!isMounted || !notification.title) return;
          toast(`🔔 ${notification.title}\n${notification.body || ''}`, {
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
      if (!token || !messaging) return;
      const endpoint = resolveFcmEndpoint(role);
      if (!endpoint) return;

      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          return;
        }

        const serviceWorkerRegistration = await navigator.serviceWorker.register(buildServiceWorkerUrl());
        const currentToken = await getToken(messaging, {
          vapidKey: firebaseVapidKey,
          serviceWorkerRegistration,
        });

        if (currentToken) {
          await fetch(`${baseURL}${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ token: currentToken }),
          });
        }

        webUnsubscribe = onMessage(messaging, (payload) => {
          if (!isMounted || !payload.notification) return;
          toast(`🔔 ${payload.notification.title}\n${payload.notification.body || ''}`, {
            duration: 5000,
          });
        });
      } catch (err) {
        console.error('Web push notification setup failed', err);
      }
    };

    if (token) {
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
          // ignore
        }
      }
      if (webUnsubscribe) {
        webUnsubscribe();
      }
    };
  }, [token, role]);
};
