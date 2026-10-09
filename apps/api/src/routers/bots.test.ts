import type * as Adapters from "@bobbot/adapters";
import type { Actor, Bot } from "@bobbot/contracts";
import { RPCHandler } from "@orpc/server/fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBotPreset } from "../bot-library.js";
import { createAuthenticatedRouter } from "../router.js";
import { createBotsRouter } from "./bots.js";

const lifecycle = vi.hoisted(() => ({ archive: vi.fn(), destroy: vi.fn() }));
vi.mock("@bobbot/adapters", async (original) => ({
  ...(await original<typeof Adapters>()),
  archiveBot: lifecycle.archive,
  destroyBot: lifecycle.destroy,
}));

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@example.test",
  isDeploymentOwner: true,
};

function fixture() {
  const stored = { id: "bot-1", userId: actor.userId, spaceId: actor.spaceId, archivedAt: null };
  const created: Bot = {
    id: "bot-1",
    spaceId: actor.spaceId,
    name: "Test",
    title: "",
    description: "",
    instructions: "",
    color: "ink",
    notifyOnFinish: true,
    pinned: false,
    sectionId: null,
    archivedAt: null,
    unread: false,
    parentBotId: null,
    memoryScope: null,
    threadId: "thread-1",
    preview: "",
    status: "idle",
    computerMode: "dedicated",
    updatedAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
    voiceId: null,
    autoSpeak: false,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    monthlyTokenBudget: null,
    teamChatAmbientEnabled: false,
    teamChatRules: "",
    webhookConfigured: false,
    spawnKey: null,
  };
  const createBot = vi.fn(async () => created);
  const getBot = vi.fn(async () => stored);
  const writeFile = vi.fn(async () => undefined);
  const intro = vi.fn(async () => undefined);
  const skills = {
    create: vi.fn(async () => ({ id: "imported-skill" })),
    remove: vi.fn(async () => ({ ok: true as const })),
  };
  const prisma = {
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({})),
    computer: { findFirst: vi.fn(async () => ({ homeKey: "private-home" })) },
  };
  const deps = { prisma, home: { writeFile } };
  const ctx = {
    deps,
    repos: { getBot, createBot, listBots: vi.fn(async () => [created]) },
    authed: createAuthenticatedRouter(),
    agentSkills: skills,
    enqueueBotIntroRun: intro,
    applyPreparedImport: vi.fn(async () => undefined),
  } as unknown as Parameters<typeof createBotsRouter>[0];
  const handler = new RPCHandler({ bots: createBotsRouter(ctx) });
  return {
    stored,
    created,
    deps,
    createBot,
    getBot,
    writeFile,
    intro,
    skills,
    prisma,
    async call(procedure: string, input: unknown, requestActor: Actor | null = actor) {
      const result = await handler.handle(
        new Request(`http://example.test/rpc/bots/${procedure}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor: requestActor } },
      );
      if (!result.matched) throw new Error("RPC not matched");
      return result.response;
    },
  };
}

afterEach(() => vi.clearAllMocks());

describe("bot lifecycle RPC wiring", () => {
  it("archives through the shared lifecycle instead of reporting an empty success", async () => {
    const f = fixture();
    expect((await f.call("archive", { botId: "bot-1" })).status).toBe(200);
    expect(lifecycle.archive).toHaveBeenCalledExactlyOnceWith(
      f.deps,
      f.stored,
      expect.objectContaining({ userId: actor.userId, spaceId: actor.spaceId, botId: "bot-1" }),
    );
  });

  it.each([false, true])("passes the memory deletion choice: %s", async (deleteMemories) => {
    const f = fixture();
    expect((await f.call("remove", { botId: "bot-1", deleteMemories })).status).toBe(200);
    expect(lifecycle.destroy).toHaveBeenCalledExactlyOnceWith(f.deps, f.stored, expect.anything(), {
      deleteMemories,
    });
  });

  it("rejects unauthenticated lifecycle requests before any effect", async () => {
    const f = fixture();
    expect((await f.call("archive", { botId: "bot-1" }, null)).status).toBe(401);
    expect(lifecycle.archive).not.toHaveBeenCalled();
    expect(f.getBot).not.toHaveBeenCalled();
  });

  it("creates using the shared intro/model check", async () => {
    const f = fixture();
    await f.call("create", { name: "Test", title: "", description: "", instructions: "" });
    expect(f.intro).toHaveBeenCalledExactlyOnceWith(f.deps, actor, f.created);
  });
});

describe("file import RPC failures", () => {
  function input() {
    const manifest = readBotPreset("data-analyst");
    if (!manifest) throw new Error("Missing fixture preset");
    return {
      manifest: { ...manifest, files: [{ path: "notes.txt", content: "synthetic" }] },
      includeFiles: true,
      includeMemory: false,
      includeSkills: false,
      includeRoutines: false,
    };
  }

  it("uses a private computer rather than overwriting a shared team home", async () => {
    const f = fixture();
    expect((await f.call("import", input())).status).toBe(200);
    expect(f.createBot).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ computerMode: "dedicated" }),
      expect.anything(),
    );
    expect(f.writeFile).toHaveBeenCalledWith(
      "private-home",
      "notes.txt",
      "synthetic",
      expect.anything(),
    );
    expect(lifecycle.destroy).not.toHaveBeenCalled();
  });

  it("removes newly created skills when a later skill fails", async () => {
    const f = fixture();
    const request = input();
    request.includeSkills = true;
    request.manifest.skills = ["First", "Second"].map((name) => ({
      name,
      content: `---\nname: ${name}\ndescription: Synthetic fixture\n---\nDo nothing.`,
    }));
    f.skills.create
      .mockResolvedValueOnce({ id: "first-new-skill" })
      .mockRejectedValueOnce(new Error("synthetic skill failure"));
    expect((await f.call("import", request)).status).toBe(500);
    expect(lifecycle.destroy).toHaveBeenCalled();
    expect(f.skills.remove).toHaveBeenCalledExactlyOnceWith(actor, "first-new-skill");
  });

  it("fails and compensates when a file write fails", async () => {
    const f = fixture();
    f.writeFile.mockRejectedValueOnce(new Error("synthetic disk failure"));
    expect((await f.call("import", input())).status).toBe(500);
    expect(lifecycle.destroy).toHaveBeenCalledWith(
      f.deps,
      f.stored,
      expect.objectContaining({ botId: "bot-1" }),
      { deleteMemories: true },
    );
    expect(f.skills.create).not.toHaveBeenCalled();
  });
});
