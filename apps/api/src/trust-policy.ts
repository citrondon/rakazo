import type {
  Actor,
  TrustPolicy,
  TrustPolicyView,
  UpdateTrustPolicyInput,
} from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { createTrustPolicyRepos } from "@rakazo/db";

export type TrustPolicyDeps = { prisma: PrismaClient; maxToolCallsPerTurn?: number };

/**
 * A space's trust policy: the risk tier that pauses a triggered routine for a person, the quiet
 * window that holds consequential work, and the per-turn tool-call fuse. Read returns the safe
 * default until a space stores its own, so a caller never has to invent one. The deployment
 * default rides along, so settings can label the state a space inherits.
 */
function withDeploymentDefault(policy: TrustPolicy, deps: TrustPolicyDeps): TrustPolicyView {
  return { ...policy, maxToolCallsPerTurnDefault: deps.maxToolCallsPerTurn ?? 0 };
}

export async function getTrustPolicy(
  deps: TrustPolicyDeps,
  actor: Actor,
): Promise<TrustPolicyView> {
  const policy = await createTrustPolicyRepos(deps.prisma).getTrustPolicy(actor);
  return withDeploymentDefault(policy, deps);
}

export async function setTrustPolicy(
  deps: TrustPolicyDeps,
  actor: Actor,
  input: UpdateTrustPolicyInput,
): Promise<TrustPolicyView> {
  const policy = await createTrustPolicyRepos(deps.prisma).setTrustPolicy(actor, input);
  return withDeploymentDefault(policy, deps);
}
