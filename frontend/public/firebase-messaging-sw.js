importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCUHWA1qeITirq6hAVJne9KD93XmTqN9AU",
  authDomain: "darmavoz-81a61.firebaseapp.com",
  projectId: "darmavoz-81a61",
  storageBucket: "darmavoz-81a61.firebasestorage.app",
  messagingSenderId: "559008540227",
  appId: "1:559008540227:web:ad83b59a1823d6be92d6f6",
  measurementId: "G-L3RWEXFWSY",
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const notificationTitle = payload.notification?.title || 'Новое уведомление';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/russian.png',
    data: payload.data || {},
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const data = event.notification.data?.FCM_MSG?.data || event.notification.data || {};
  const params = new URLSearchParams();
  if (data.city_id) params.set("notification_city", data.city_id);
  if (/^[0-9a-f-]{36}$/i.test(data.order_id || '')) params.set('notification_order', data.order_id);
  if (/^[0-9a-f-]{36}$/i.test(data.entity_id || '')) { params.set('notification_entity', data.entity_id); params.set('entity_type', data.entity_type || ''); }
  event.waitUntil(clients.openWindow('/?' + params.toString()));
});
