import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { createRoutineToolRepos } from "./routine-tools.js";

function reposFor(prisma: Record<string, unknown>) {
  return createRoutineToolRepos(prisma as unknown as PrismaClient);
}

describe("createRoutineToolRepos.listBotToolDescriptors", () => {
  it("scopes to the actor's space and user and returns connected providers plus installs", async () => {
    const connectionFindMany = vi.fn(async (_args: unknown) => [{ provider: "github" }]);
    const installFindMany = vi.fn(async (_args: unknown) => [{ name: "acme_api" }]);
    const repos = reposFor({
      connection: { findMany: connectionFindMany },
      capabilityInstall: { findMany: installFindMany },
    });

    const descriptors = await repos.listBotToolDescriptors({ spaceId: "ws-1", userId: "user-1" });

    expect(connectionFindMany.mock.calls[0]![0]).toEqual({
      where: { spaceId: "ws-1", userId: "user-1", status: "connected" },
      select: { provider: true },
    });
    expect(installFindMany.mock.calls[0]![0]).toEqual({
      where: { spaceId: "ws-1", userId: "user-1" },
      select: { name: true },
    });
    expect(descriptors).toEqual([
      { name: "github", viaConnector: true },
      { name: "acme_api", viaConnector: true },
    ]);
  });

  it("collapses a provider that appears more than once", async () => {
    const repos = reposFor({
      connection: { findMany: vi.fn(async () => [{ provider: "slack" }, { provider: "slack" }]) },
      capabilityInstall: { findMany: vi.fn(async () => []) },
    });

    const descriptors = await repos.listBotToolDescriptors({ spaceId: "ws-1", userId: "user-1" });

    expect(descriptors).toEqual([{ name: "slack", viaConnector: true }]);
  });

  it("returns nothing when the bot reaches no integrations", async () => {
    const repos = reposFor({
      connection: { findMany: vi.fn(async () => []) },
      capabilityInstall: { findMany: vi.fn(async () => []) },
    });

    await expect(
      repos.listBotToolDescriptors({ spaceId: "ws-1", userId: "user-1" }),
    ).resolves.toEqual([]);
  });
});
