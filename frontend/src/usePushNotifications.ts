import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { useAuthStore } from './store';
import { baseURL } from './utils';
import toast from 'react-hot-toast';
import { Capacitor } from '@capacitor/core';
import { messaging, getToken, onMessage } from './services/firebase';

export const usePushNotifications = () => {
  const { token, role } = useAuthStore();

  useEffect(() => {
    let isMounted = true;
    let webUnsubscribe: (() => void) | undefined;

    const setupNativePushNotifications = async () => {
      if (!token) return;
      // We only register driver for Capacitor currently?
      // Let's register client and driver since endpoints exist for both now.

      try {
        // Request permissions
        let permStatus = await PushNotifications.checkPermissions();
        
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.warn('Push notification permissions not granted');
          return;
        }

        // Register with Apple/Google to receive push via APNS/FCM
        await PushNotifications.register();

        // On success, we should be able to receive notifications
        PushNotifications.addListener('registration', async (capacitorToken) => {
          if (!isMounted) return;
          try {
            const endpoint = role === 'client' ? '/clients/me/fcm-token' : (role === 'driver' ? '/driver/fcm-token' : null);
            if (!endpoint) return;

            await fetch(`${baseURL}${endpoint}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ token: capacitorToken.value }),
            });
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
          // Show toast when notification is received while app is open
          if (notification.title) {
            toast.info(`🔔 ${notification.title}\n${notification.body || ''}`, {
              duration: 5000,
            });
          }
        });

        PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (notification) => {
            console.log('Push action performed: ' + JSON.stringify(notification));
          }
        );
      } catch (error) {
        console.error('Push notification setup failed', error);
      }
    };

    const setupWebPushNotifications = async () => {
       if (!token || !messaging) return;
       const endpoint = role === 'client' ? '/clients/me/fcm-token' : (role === 'driver' ? '/driver/fcm-token' : null);
       if (!endpoint) return;

       try {
         const permission = await Notification.requestPermission();
         if (permission === 'granted') {
           const vapidKey = 'BMAlldh0o6OYBIQg0M5s8lP8jRBVMHPzzwR2VjPz_OnrKuUM9NxyR1asRVGBYQCcH7zYrF9Z2TEskxHunaWguVk';
           const currentToken = await getToken(messaging, { vapidKey });
           
           if (currentToken) {
             await fetch(`${baseURL}${endpoint}`, {
               method: 'POST',
               headers: {
                 'Content-Type': 'application/json',
                 Authorization: `Bearer ${token}`,
               },
               body: JSON.stringify({ token: currentToken }),
             });
             console.log('FCM token sent to backend (Web)');
           }
         }

         webUnsubscribe = onMessage(messaging, (payload) => {
           if (!isMounted) return;
           if (payload.notification) {
             toast.info(`🔔 ${payload.notification.title}\n${payload.notification.body || ''}`, {
               duration: 5000,
             });
           }
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
        } catch (e) {
            // ignore
        }
      }
      if (webUnsubscribe) {
        webUnsubscribe();
      }
    };
  }, [token, role]);
};
