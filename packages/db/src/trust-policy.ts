import type { Actor, TrustPolicy, UpdateTrustPolicyInput } from "@rakazo/contracts";
import { DEFAULT_TRUST_POLICY, resolveTrustPolicy } from "@rakazo/core";
import { Prisma, type PrismaClient } from "./client.js";

type TrustPolicyRecord = {
  approvalThreshold: string;
  quietHours: unknown;
};

function mapPolicy(record: TrustPolicyRecord | null): TrustPolicy {
  if (!record) return { ...DEFAULT_TRUST_POLICY };
  return resolveTrustPolicy({
    approvalThreshold: record.approvalThreshold as TrustPolicy["approvalThreshold"],
    quietHours: (record.quietHours ?? null) as TrustPolicy["quietHours"],
  });
}

/**
 * A space's trust policy: the risk tier at which a triggered routine pauses for a person, and
 * the quiet window that holds consequential work. Every read and write is scoped to the
 * actor's own space, so one space's policy can never gate another's runs. A space with no
 * stored policy gets the safe default, never an implicit allow.
 */
export function createTrustPolicyRepos(prisma: PrismaClient) {
  return {
    async getTrustPolicy(scope: { spaceId: string }): Promise<TrustPolicy> {
      const row = await prisma.trustPolicy.findUnique({
        where: { spaceId: scope.spaceId },
        select: { approvalThreshold: true, quietHours: true },
      });
      return mapPolicy(row as TrustPolicyRecord | null);
    },

    async setTrustPolicy(actor: Actor, input: UpdateTrustPolicyInput): Promise<TrustPolicy> {
      const quietHours =
        input.quietHours === null ? Prisma.DbNull : (input.quietHours as Prisma.InputJsonValue);
      const row = await prisma.trustPolicy.upsert({
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
      });
      return mapPolicy(row as TrustPolicyRecord);
    },
  };
}

export type TrustPolicyRepos = ReturnType<typeof createTrustPolicyRepos>;
