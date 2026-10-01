import type { Actor, UpdateTrustPolicyInput } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { createTrustPolicyRepos } from "@rakazo/db";

export type TrustPolicyDeps = { prisma: PrismaClient };

/**
 * A space's trust policy: the risk tier that pauses a triggered routine for a person, and the
 * quiet window that holds consequential work. Read returns the safe default until a space
 * stores its own, so a caller never has to invent one.
 */
export function getTrustPolicy(deps: TrustPolicyDeps, actor: Actor) {
  return createTrustPolicyRepos(deps.prisma).getTrustPolicy(actor);
}

export function setTrustPolicy(deps: TrustPolicyDeps, actor: Actor, input: UpdateTrustPolicyInput) {
  return createTrustPolicyRepos(deps.prisma).setTrustPolicy(actor, input);
}
