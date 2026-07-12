import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { useAuthStore } from '../../store';
import { baseURL } from '../../utils';
import {
  deleteToken,
  messaging,
} from '../../services/firebase';
import { getWebPushTokenWithRetry } from '../../services/webPush';
import { emitPushSettingsChanged, getPushTokenEndpoint } from '../../pushAuth';

interface NotificationToggleProps {
  role: 'client' | 'driver' | 'admin' | 'logist';
}

export const NotificationToggle: React.FC<NotificationToggleProps> = ({ role }) => {
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { token } = useAuthStore();

  useEffect(() => {
    const checkStatus = async () => {
      const savedStatus = localStorage.getItem(`push_enabled_${role}`);
      if (savedStatus === 'true') {
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
    const endpoint = getPushTokenEndpoint(role);

    if (!endpoint || !token) {
      toast.error('Не удалось определить endpoint уведомлений');
      setIsLoading(false);
      return;
    }

    if (isPushEnabled) {
      try {
        const res = await fetch(`${baseURL}${endpoint}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.ok) {
          if (!Capacitor.isNativePlatform() && messaging) {
            try {
              await deleteToken(messaging);
            } catch {
              // ignore local token cleanup errors
            }
          }
          setIsPushEnabled(false);
          localStorage.setItem(`push_enabled_${role}`, 'false');
          emitPushSettingsChanged(role);
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
      return;
    }

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

        await PushNotifications.register();
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          toast.error('Разрешите уведомления в настройках браузера/телефона');
          setIsLoading(false);
          return;
        }

        if (!messaging) {
          toast.error('Ошибка конфигурации Firebase');
          setIsLoading(false);
          return;
        }

        currentToken = await getWebPushTokenWithRetry();
        if (!currentToken) {
          console.error('Web push enable failed: empty Firebase token', { role });
          toast.error('Не удалось получить push-токен браузера. Попробуйте еще раз.');
          return;
        }
      }

      if (currentToken) {
        const res = await fetch(`${baseURL}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ token: currentToken }),
        });

        if (!res.ok) {
          toast.error('Не удалось включить уведомления');
          return;
        }
      }

      setIsPushEnabled(true);
      localStorage.setItem(`push_enabled_${role}`, 'true');
      emitPushSettingsChanged(role);
      toast.success('Уведомления включены');
    } catch (error) {
      console.error('Error enabling push:', error);
      toast.error('Ошибка при включении уведомлений');
    } finally {
      setIsLoading(false);
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
