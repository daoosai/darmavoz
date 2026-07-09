import { deleteToken, messaging } from "./services/firebase";
import { useAuthStore, UserRole } from "./store";
import { baseURL } from "./utils";

export const getPushTokenEndpoint = (
  role: UserRole | string | null | undefined,
): string | null => {
  switch (role) {
    case "client":
      return "/clients/me/fcm-token";
    case "driver":
      return "/driver/fcm-token";
    case "logist":
    case "admin":
      return "/logist/me/fcm-token";
    default:
      return null;
  }
};

export const detachPushToken = async (
  role: UserRole | string | null | undefined,
  authToken: string | null | undefined,
): Promise<void> => {
  const endpoint = getPushTokenEndpoint(role);
  if (!endpoint || !authToken) {
    return;
  }

  try {
    await fetch(`${baseURL}${endpoint}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
  } catch {
    // best-effort cleanup
  }
};

export const clearLocalWebPushToken = async (): Promise<void> => {
  if (!messaging) {
    return;
  }

  try {
    await deleteToken(messaging);
  } catch {
    // best-effort cleanup
  }
};

export const logoutCurrentSession = async (): Promise<void> => {
  const { token, role, logout } = useAuthStore.getState();
  await detachPushToken(role, token);
  await clearLocalWebPushToken();
  logout();
};

export const switchAuthenticatedSession = async ({
  token,
  role,
  driverId,
}: {
  token: string;
  role: UserRole;
  driverId?: string;
}): Promise<void> => {
  const currentSession = useAuthStore.getState();
  if (currentSession.token && currentSession.role) {
    await detachPushToken(currentSession.role, currentSession.token);
  }
  await clearLocalWebPushToken();
  currentSession.login(token, role, driverId);
};
