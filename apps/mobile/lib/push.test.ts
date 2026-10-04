import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
}));
vi.mock("expo-constants", () => ({
  default: { easConfig: { projectId: "project-1" } },
}));
vi.mock("./api", () => ({ rpc: vi.fn() }));
vi.mock("./installation", () => ({ installationId: vi.fn(async () => "install-1") }));

import * as Notifications from "expo-notifications";
import { rpc } from "./api";
import { registerPushToken } from "./push";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
});

describe("mobile push registration", () => {
  it("registers the token for this installation", async () => {
    vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
      data: "ExponentPushToken[device]",
    } as never);
    vi.mocked(rpc).mockResolvedValue({ ok: true } as never);

    await registerPushToken();

    expect(rpc).toHaveBeenCalledWith("notifications/registerPush", {
      token: "ExponentPushToken[device]",
      deviceId: "install-1",
    });
  });

  it("surfaces a server failure instead of reporting success", async () => {
    vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
      data: "ExponentPushToken[device]",
    } as never);
    vi.mocked(rpc).mockRejectedValue(new Error("offline"));

    await expect(registerPushToken()).rejects.toThrow("offline");
  });

  it("asks for permission and registers once granted", async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
    vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
      data: "ExponentPushToken[device]",
    } as never);
    vi.mocked(rpc).mockResolvedValue({ ok: true } as never);

    await registerPushToken();

    expect(rpc).toHaveBeenCalledOnce();
  });

  it("stays silent when permission is denied", async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
    vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: false } as never);

    await registerPushToken();

    expect(rpc).not.toHaveBeenCalled();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });
});
