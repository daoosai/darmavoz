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
  event.waitUntil(clients.openWindow('/'));
});
