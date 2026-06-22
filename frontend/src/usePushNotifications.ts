import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { useAuthStore } from './store';
import { baseURL } from './utils';
import toast from 'react-hot-toast';
import { Capacitor } from '@capacitor/core';

export const usePushNotifications = () => {
  const { token, role } = useAuthStore();

  useEffect(() => {
    let isMounted = true;

    const setupPushNotifications = async () => {
      // PushNotifications are only available on native devices
      if (!Capacitor.isNativePlatform()) {
        return;
      }

      if (!token || role !== 'driver') return;

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
            await fetch(`${baseURL}/driver/fcm-token`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ token: capacitorToken.value }),
            });
            console.log('FCM token sent to backend');
          } catch (error) {
            console.error('Failed to send FCM token to backend', error);
          }
        });

        PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error on registration: ' + JSON.stringify(error));
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          if (!isMounted) return;
          // Show toast when notification is received while app is open
          if (notification.title) {
            toast.success(`${notification.title}\n${notification.body || ''}`, {
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

    setupPushNotifications();

    return () => {
      isMounted = false;
      if (Capacitor.isNativePlatform()) {
        PushNotifications.removeAllListeners();
      }
    };
  }, [token]);
};
