import { initializeApp } from "firebase/app";
import { deleteToken, getMessaging, getToken, onMessage } from "firebase/messaging";

export const FIREBASE_WEB_CONFIG = {
  apiKey: "AIzaSyCUHWA1qeITirq6hAVJne9KD93XmTqN9AU",
  authDomain: "darmavoz-81a61.firebaseapp.com",
  projectId: "darmavoz-81a61",
  storageBucket: "darmavoz-81a61.firebasestorage.app",
  messagingSenderId: "559008540227",
  appId: "1:559008540227:web:ad83b59a1823d6be92d6f6",
  measurementId: "G-L3RWEXFWSY",
};

export const FIREBASE_WEB_VAPID_KEY = "BMAlldh0o6OYBIQg0M5s8lP8jRBVMHPzzwR2VjPz_OnrKuUM9NxyR1asRVGBYQCcH7zYrF9Z2TEskxHunaWguVk";

const app = initializeApp(FIREBASE_WEB_CONFIG);

export const messaging =
  typeof window !== "undefined" && "serviceWorker" in navigator ? getMessaging(app) : null;

export const ensureFirebaseMessagingServiceWorker = async (): Promise<ServiceWorkerRegistration> => {
  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

  if (registration.active) {
    return registration;
  }

  return navigator.serviceWorker.ready;
};

export { deleteToken, getToken, onMessage };
