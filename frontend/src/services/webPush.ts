import {
  ensureFirebaseMessagingServiceWorker,
  FIREBASE_WEB_VAPID_KEY,
  getToken,
  messaging,
} from './firebase';

const WEB_PUSH_TOKEN_RETRY_DELAYS_MS = [0, 400, 1200];

const wait = (delayMs: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

export const getWebPushTokenWithRetry = async (): Promise<string | null> => {
  if (!messaging) {
    console.error('Web push messaging is not configured');
    return null;
  }

  const serviceWorkerRegistration = await ensureFirebaseMessagingServiceWorker();

  for (let attempt = 0; attempt < WEB_PUSH_TOKEN_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = WEB_PUSH_TOKEN_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await wait(delayMs);
    }

    try {
      const currentToken = await getToken(messaging, {
        vapidKey: FIREBASE_WEB_VAPID_KEY,
        serviceWorkerRegistration,
      });

      if (currentToken) {
        if (attempt > 0) {
          console.info('Web push token obtained after retry', { attempt: attempt + 1 });
        }
        return currentToken;
      }
    } catch (error) {
      console.error('Web push token request failed', {
        attempt: attempt + 1,
        error,
      });
    }
  }

  console.error('Web push token is empty after retries');
  return null;
};
