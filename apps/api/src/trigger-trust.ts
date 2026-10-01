import { planRoutineEffects, planRunTrust } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { createRoutineToolRepos, createTrustPolicyRepos } from "@rakazo/db";
import type { WebhookRunTrust, WebhookTrustPlanner } from "./webhook-inbound.js";

/**
 * Resolve a wake's trust plan from the bot's reachable tools and the space policy. All planning
 * is pure in @rakazo/core; this only reads storage and calls it, so the wake path stays a thin
 * boundary. A space with no policy gets the safe default, so an unconfigured space still asks
 * before a connected integration writes.
 */
export function createWebhookTrustPlanner(prisma: PrismaClient): WebhookTrustPlanner {
  const tools = createRoutineToolRepos(prisma);
  const policies = createTrustPolicyRepos(prisma);
  return async ({ spaceId, userId, now }): Promise<WebhookRunTrust> => {
    const [descriptors, policy] = await Promise.all([
      tools.listBotToolDescriptors({ spaceId, userId }),
      policies.getTrustPolicy({ spaceId }),
    ]);
    const effects = planRoutineEffects(descriptors);
    const { phase, paused, resumeAt } = planRunTrust(effects, policy, now ?? new Date());
    return { phase, paused, effects, resumeAt };
  };
}
