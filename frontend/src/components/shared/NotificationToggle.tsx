import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { baseURL } from '../../utils';
import { messaging, getToken } from '../../services/firebase';
import { useAuthStore } from '../../store';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

interface NotificationToggleProps {
  role: 'client' | 'driver' | 'admin' | 'logist';
}

export const NotificationToggle: React.FC<NotificationToggleProps> = ({ role }) => {
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { token } = useAuthStore();

  useEffect(() => {
    const checkStatus = async () => {
      // Restore from localStorage
      const savedStatus = localStorage.getItem(`push_enabled_${role}`);
      if (savedStatus === 'true') {
        // Double check permission
        if (Capacitor.isNativePlatform()) {
           const perm = await PushNotifications.checkPermissions();
           setIsPushEnabled(perm.receive === 'granted');
        } else {
           setIsPushEnabled(Notification.permission === 'granted');
        }
      }
    };
    checkStatus();
  }, [role]);

  const handleToggle = async () => {
    setIsLoading(true);

    if (isPushEnabled) {
      // ВЫКЛЮЧИТЬ (OFF)
      try {
        let endpoint = '';
        if (role === 'client') endpoint = '/clients/me/fcm-token';
        else if (role === 'driver') endpoint = '/driver/fcm-token';
        else endpoint = '/admin/fcm-token';

        const res = await fetch(`${baseURL}${endpoint}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.ok) {
          setIsPushEnabled(false);
          localStorage.setItem(`push_enabled_${role}`, 'false');
          toast.success('Уведомления отключены');
        } else {
          toast.error('Не удалось отключить уведомления');
        }
      } catch (error) {
        console.error('Error disabling push:', error);
        toast.error('Ошибка при отключении уведомлений');
      } finally {
        setIsLoading(false);
      }
    } else {
      // ВКЛЮЧИТЬ (ON)
      try {
        let currentToken: string | null = null;

        if (Capacitor.isNativePlatform()) {
          let permStatus = await PushNotifications.checkPermissions();
          if (permStatus.receive === 'prompt') {
            permStatus = await PushNotifications.requestPermissions();
          }
          if (permStatus.receive !== 'granted') {
            toast.error('Разрешите уведомления в настройках телефона');
            setIsLoading(false);
            return;
          }

          // Native token registration is handled globally in usePushNotifications
          // But we can manually dispatch it or rely on the hook if we just enable it
          // Actually, we need to register here to get the token, 
          // let's do a simple Web approach first if not native, but for native we rely on PushNotifications
          await PushNotifications.register();
          // The native listener will catch it, but we can't easily wait for it here 
          // unless we wrap it in a Promise. Let's just set state and let usePushNotifications handle the backend.
          // Wait, the prompt says "получи токен через getToken из Firebase". Let's do it for web.
        } else {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
            toast.error('Разрешите уведомления в настройках браузера/телефона');
            setIsLoading(false);
            return;
          }

          if (messaging) {
            const vapidKey = 'BMAlldh0o6OYBIQg0M5s8lP8jRBVMHPzzwR2VjPz_OnrKuUM9NxyR1asRVGBYQCcH7zYrF9Z2TEskxHunaWguVk';
            currentToken = await getToken(messaging, { vapidKey });
          } else {
            toast.error('Ошибка конфигурации Firebase');
            setIsLoading(false);
            return;
          }
        }

        if (currentToken) {
          let endpoint = '';
          if (role === 'client') endpoint = '/clients/me/fcm-token';
          else if (role === 'driver') endpoint = '/driver/fcm-token';
          else endpoint = '/admin/fcm-token';

          const res = await fetch(`${baseURL}${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ token: currentToken }),
          });

          if (res.ok) {
            setIsPushEnabled(true);
            localStorage.setItem(`push_enabled_${role}`, 'true');
            toast.success('Уведомления включены');
          } else {
            toast.error('Не удалось включить уведомления');
          }
        } else {
          if (Capacitor.isNativePlatform()) {
             setIsPushEnabled(true);
             localStorage.setItem(`push_enabled_${role}`, 'true');
             toast.success('Уведомления включены');
          }
        }
      } catch (error) {
        console.error('Error enabling push:', error);
        toast.error('Ошибка при включении уведомлений');
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center mt-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
          <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-gray-900">Push-уведомления</p>
          <p className="text-xs text-gray-500">Статусы заказов и важные алерты</p>
        </div>
      </div>
      <button 
        onClick={handleToggle}
        disabled={isLoading}
        className={`w-12 h-6 rounded-full p-1 transition-colors ${isPushEnabled ? 'bg-blue-500' : 'bg-gray-300'}`}
      >
        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${isPushEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
      </button>
    </div>
  );
};
