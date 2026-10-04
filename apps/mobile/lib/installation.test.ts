import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import * as SecureStore from "expo-secure-store";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function loadInstallationId() {
  const { installationId } = await import("./installation");
  return installationId;
}

describe("mobile installation id", () => {
  it("reuses the id stored on this device", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("stored-installation");
    const installationId = await loadInstallationId();

    await expect(installationId()).resolves.toBe("stored-installation");
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("mints and persists one stable id when nothing is stored", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    const installationId = await loadInstallationId();

    const first = await installationId();
    const second = await installationId();

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("rakazo.installation_id", first);
  });
});
