import type { Actor, TrustPolicy, UpdateTrustPolicyInput } from "@rakazo/contracts";
import { resolveTrustPolicy } from "@rakazo/core";
import { Prisma, type PrismaClient } from "./client.js";

type TrustPolicyRecord = {
  approvalThreshold: string;
  quietHours: unknown;
};

/** One space row plus its optional `trust_policies` row; null when the space is unknown. */
type SpacePolicyRow = {
  maxToolCallsPerTurn: number | null;
  trustPolicy: TrustPolicyRecord | null;
} | null;

function mapPolicy(row: SpacePolicyRow): TrustPolicy {
  return resolveTrustPolicy({
    approvalThreshold: row?.trustPolicy?.approvalThreshold as TrustPolicy["approvalThreshold"],
    quietHours: (row?.trustPolicy?.quietHours ?? null) as TrustPolicy["quietHours"],
    // A space with no stored limit (or an unknown space) inherits the deployment value.
    maxToolCallsPerTurn: row?.maxToolCallsPerTurn ?? null,
  });
}

/**
 * A space's trust policy: the risk tier at which a triggered routine pauses for a person, the
 * quiet window that holds consequential work, and the per-turn tool-call fuse. Every read and
 * write is scoped to the actor's own space, so one space's policy can never gate another's runs.
 * A space with no stored policy gets the safe default, never an implicit allow.
 */
export function createTrustPolicyRepos(prisma: PrismaClient) {
  return {
    async getTrustPolicy(scope: { spaceId: string }): Promise<TrustPolicy> {
      // Read the space row, not only the policy row: a space that never stored a policy still
      // carries its own tool-call fuse.
      const row = await prisma.space.findUnique({
        where: { id: scope.spaceId },
        select: {
          maxToolCallsPerTurn: true,
          trustPolicy: { select: { approvalThreshold: true, quietHours: true } },
        },
      });
      return mapPolicy(row);
    },

    async setTrustPolicy(actor: Actor, input: UpdateTrustPolicyInput): Promise<TrustPolicy> {
      const quietHours =
        input.quietHours === null ? Prisma.DbNull : (input.quietHours as Prisma.InputJsonValue);
      // Both tables move together, and every write stays scoped to the actor's own space — never
      // a caller-supplied id. `maxToolCallsPerTurn: null` clears the column back to inherited.
      const [policyRow, spaceRow] = await prisma.$transaction([
        prisma.trustPolicy.upsert({
          where: { spaceId: actor.spaceId },
          create: {
            spaceId: actor.spaceId,
            createdByUserId: actor.userId,
            approvalThreshold: input.approvalThreshold,
            quietHours,
          },
          update: {
            approvalThreshold: input.approvalThreshold,
            quietHours,
          },
          select: { approvalThreshold: true, quietHours: true },
        }),
        prisma.space.update({
          where: { id: actor.spaceId },
          data: { maxToolCallsPerTurn: input.maxToolCallsPerTurn },
          select: { maxToolCallsPerTurn: true },
        }),
      ]);
      return mapPolicy({
        maxToolCallsPerTurn: spaceRow.maxToolCallsPerTurn,
        trustPolicy: policyRow,
      });
    },
  };
}

export type TrustPolicyRepos = ReturnType<typeof createTrustPolicyRepos>;
