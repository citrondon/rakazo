import * as SecureStore from "expo-secure-store";

const INSTALLATION_KEY = "rakazo.installation_id";

let cached: string | undefined;

function newInstallationId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable per-installation id so two devices on one account keep separate push tokens. */
export async function installationId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await SecureStore.getItemAsync(INSTALLATION_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {
    // Fall through and mint a fresh id; it is persisted on the next attempt.
  }
  const created = newInstallationId();
  try {
    await SecureStore.setItemAsync(INSTALLATION_KEY, created);
  } catch {
    // Keep the in-memory id so this session still registers a device-scoped token.
  }
  cached = created;
  return created;
}
