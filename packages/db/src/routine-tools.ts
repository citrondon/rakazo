import type { RoutineToolDescriptor } from "@rakazo/core";
import type { PrismaClient } from "./client.js";

/**
 * The tools a routine's bot can reach, at the granularity the pre-run path has: its stored
 * integrations and installed APIs. The descriptor is deliberately coarse — a provider slug,
 * not a resolved tool — because resolving live tools needs a network call a wake must not
 * make. The effect planner treats any connected integration as a possible write, so the plan
 * never understates what a run could touch.
 */
export function createRoutineToolRepos(prisma: PrismaClient) {
  return {
    async listBotToolDescriptors(input: {
      spaceId: string;
      userId: string;
    }): Promise<RoutineToolDescriptor[]> {
      const [connections, installs] = await Promise.all([
        prisma.connection.findMany({
          where: { spaceId: input.spaceId, userId: input.userId, status: "connected" },
          select: { provider: true },
        }),
        prisma.capabilityInstall.findMany({
          where: { spaceId: input.spaceId, userId: input.userId },
          select: { name: true },
        }),
      ]);
      const byName = new Map<string, RoutineToolDescriptor>();
      for (const connection of connections) {
        byName.set(connection.provider, { name: connection.provider, viaConnector: true });
      }
      for (const install of installs) {
        byName.set(install.name, { name: install.name, viaConnector: true });
      }
      return [...byName.values()];
    },
  };
}

export type RoutineToolRepos = ReturnType<typeof createRoutineToolRepos>;
