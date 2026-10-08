import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { activityNotificationsEnabled, activityPromptSnippet, listSpaceRuns } from "./runs.js";

describe("run activity copy", () => {
  it("presents structured agent messages instead of their internal wake prompt", () => {
    expect(
      activityPromptSnippet({
        trigger: "bot_message",
        prompt: "[bot] A message just arrived from another bot with internal routing data",
        sourceBlocks: [
          {
            kind: "bot_message_received",
            fromBotId: "maya",
            fromBotName: "Maya",
            text: "Please check the release workflow.",
            intent: "request",
          },
        ],
      }),
    ).toBe("Maya asked: Please check the release workflow.");
  });

  it("fails closed when an agent message has no valid structured source", () => {
    expect(
      activityPromptSnippet({
        trigger: "bot_message",
        prompt: "[bot] private internal routing envelope",
        sourceBlocks: [{ kind: "text", text: "not a peer message" }],
      }),
    ).toBe("Message from another agent");
  });
});

describe("run activity notification preference", () => {
  it("silences only direct messages", () => {
    expect(activityNotificationsEnabled(null, false)).toBe(false);
    expect(activityNotificationsEnabled("group-1", false)).toBe(true);
  });
});

const actor = { spaceId: "space-1", userId: "user-1" } as Actor;

async function whereFor(filter: "active" | "recent" | "unattended") {
  const args: { where?: unknown }[] = [];
  const prisma = {
    run: {
      findMany: async (input: { where?: unknown }) => {
        args.push(input);
        return [];
      },
    },
  } as unknown as PrismaClient;
  await listSpaceRuns(prisma, actor, filter);
  return args[0]?.where;
}

describe("run activity filters", () => {
  it("lists the triggers no person started, in any status", async () => {
    const where = (await whereFor("unattended")) as Record<string, unknown>;
    expect(where.trigger).toEqual({
      in: ["routine", "bot_message", "spawn", "webhook", "cloud_agent"],
    });
    // A messaging run has a person behind it somewhere, so it stays out of this list.
    expect((where.trigger as { in: string[] }).in).not.toContain("messaging");
    expect(where).not.toHaveProperty("status");
  });

  it("keeps the recent list on finished runs", async () => {
    const where = (await whereFor("recent")) as Record<string, unknown>;
    expect(where.status).toEqual({ in: ["completed", "failed", "cancelled"] });
    expect(where).not.toHaveProperty("trigger");
  });

  it("keeps the active list on running runs", async () => {
    const where = (await whereFor("active")) as Record<string, unknown>;
    expect(where).not.toHaveProperty("trigger");
    expect(where.status).toBeDefined();
  });
});
