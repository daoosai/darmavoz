import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

export const firebaseMessagingConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

export const firebaseVapidKey =
  import.meta.env.VITE_FIREBASE_VAPID_KEY ||
  import.meta.env.VITE_FIREBASE_API_KEY ||
  "BMAlldh0o6OYBIQg0M5s8lP8jRBVMHPzzwR2VjPz_OnrKuUM9NxyR1asRVGBYQCcH7zYrF9Z2TEskxHunaWguVk";

const hasFirebaseConfig = Object.values(firebaseMessagingConfig).every(Boolean);
const app = hasFirebaseConfig ? initializeApp(firebaseMessagingConfig) : null;

export const messaging =
  app && typeof window !== "undefined" && "serviceWorker" in navigator
    ? getMessaging(app)
    : null;

export { getToken, onMessage };
