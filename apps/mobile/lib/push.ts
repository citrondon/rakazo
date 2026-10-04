import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { rpc } from "./api";
import { installationId } from "./installation";

/**
 * Registers this installation's push token. Expected Expo Go skips return quietly; a real
 * server/network failure rejects so the caller can surface it instead of reporting success.
 */
export async function registerPushToken(): Promise<void> {
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  let token: string;
  try {
    const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    // Expo Go cannot mint an ExponentPushToken without an EAS project id.
    return;
  }
  if (!token) return;
  await rpc("notifications/registerPush", { token, deviceId: await installationId() });
}
