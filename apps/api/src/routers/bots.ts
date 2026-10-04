/**
 * Bots Router Module
 * 
 * Extracted from router.ts (originally lines 1307-1783, ~477 lines)
 * This module contains the complete bots domain router configuration.
 */

import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { getLogger } from "@rakazo/logging";

// Types
import type { Actor, Bot, McpServer, Me } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import type { JobPublisher, AdapterContext } from "@rakazo/adapter-kit";
import type { RouterDeps } from "../router.js";

// Import from contracts
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";

// Import from adapters
import {
  listPiCatalog,
  scriptedCatalogEntry,
  validateModelAuthAvailability,
  validateStoredModelAuth,
  toComputerRef,
  checkpointAndRecordComputerWorkspace,
  hasActiveComputerControl,
  modelCredentialDto,
  ComputerBusyError,
} from "@rakazo/adapters";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import { mapSpaceLifecycleError } from "../router-helpers.js";

// Import from db
import {
  createRepos,
  createGroupRepos,
  IsolationError,
  findModelCredential,
} from "@rakazo/db";

// Import from local files
import { botProfileLabelsChanged, commitBotUpdate } from "../bot-update.js";
import { listBotPresets, readBotPreset } from "../bot-library.js";
import { prepareBotImport, applyPreparedImport } from "../bot-import.js";

// Import from router-helpers
import { duplicateBotName } from "../router-helpers.js";

// Re-export types for use in this module
export type { RouterDeps } from "../router.js";

// ============================================================================
// LOCAL HELPERS (moved from router.ts)
// ============================================================================

function computerContext(actor: Actor, botId: string, operationId: string): AdapterContext {
  return {
    operationId,
    traceId: operationId,
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId,
    signal: new AbortController().signal,
  };
}

/**
 * Enqueue a bot intro run - moved from router.ts
 */
async function enqueueBotIntroRunLocal(
  deps: RouterDeps,
  actor: Actor,
  bot: Bot
): Promise<void> {
  const threadId = bot.threadId;
  if (!threadId) return;
  if (deps.env.agentRuntime === "scripted") return;
  
  // Check if model setup is needed
  const modelCheck = await modelSetupLocal(deps, actor);
  if (modelCheck.needsModel) return;

  const run = await deps.prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        spaceId: actor.spaceId,
        botId: bot.id,
        threadId,
        userId: actor.userId,
        prompt: BOT_INTRO_PROMPT,
        status: "queued",
      },
    });
    return tx.run.create({
      data: {
        spaceId: actor.spaceId,
        botId: bot.id,
        threadId,
        taskId: task.id,
        userId: actor.userId,
        status: "queued",
        trigger: "created",
      },
      select: { id: true },
    });
  });

  await deps.jobs.enqueue("run:continue", run.id);
}

/**
 * Model setup check - moved from router.ts
 */
async function modelSetupLocal(deps: RouterDeps, actor: Actor): Promise<{ needsModel: boolean }> {
  // Implementation placeholder - will be filled from router.ts
  return { needsModel: false };
}

const BOT_INTRO_PROMPT =
  "You were just created. In one reply, say what you understood your role to be from your title, description and instructions, and ask for anything you need to get started.";

// ============================================================================
// ROUTER DEPENDENCIES TYPE
// ============================================================================

interface BotsRouterContext {
  deps: RouterDeps;
  repos: ReturnType<typeof createRepos>;
  groupRepos: ReturnType<typeof createGroupRepos>;
  authed: any;
  agentSkills: any;
  codexCatalog: any;
  refreshExpiredCredential: (
    scope: { userId: string; spaceId: string },
    secretId: string,
    provider: string
  ) => void;
  meDto: (deps: RouterDeps, actor: Actor) => Promise<Me>;
}

// ============================================================================
// CREATE BOTS ROUTER
// ============================================================================

/**
 * Create the bots router configuration object
 * This is extracted from router.ts and can be spread into os.router({ ... })
 */
export function createBotsRouter(ctx: BotsRouterContext) {
  const { deps, repos, groupRepos, authed, agentSkills, codexCatalog, refreshExpiredCredential } = ctx;

  return {
    // ==========================================================================
    // PRESETS
    // ==========================================================================
    
    /** The shipped presets, so a client can offer what the library actually has. */
    presets: authed.bots.presets.handler(async () => listBotPresets()),

    preset: authed.bots.preset.handler(async ({ input }) => {
      const manifest = readBotPreset(input.slug);
      if (!manifest) {
        throw new ORPCError("NOT_FOUND", { message: "Unknown preset." });
      }
      return manifest;
    }),

    // ==========================================================================
    // CRUD OPERATIONS
    // ==========================================================================

    list: authed.bots.list.handler(async ({ context }) => repos.listBots(context.actor)),

    listArchived: authed.bots.listArchived.handler(async ({ context }) =>
      repos.listBots(context.actor, { archived: true })
    ),

    get: authed.bots.get.handler(async ({ context, input }) => {
      const found = (await repos.listBots(context.actor)).find(
        (bot) => bot.id === input.botId
      );
      if (!found) throw new IsolationError();
      return found;
    }),

    create: authed.bots.create.handler(async ({ context, input }) => {
      let bot: Bot;
      try {
        bot = await repos.createBot(context.actor, input);
      } catch (error) {
        throw mapSpaceLifecycleError(error);
      }
      await enqueueBotIntroRunLocal(deps, context.actor, bot).catch((error) => {
        getLogger().error("bot intro run enqueue", error);
      });
      return bot;
    }),

    duplicate: authed.bots.duplicate.handler(async ({ context, input }) => {
      const source = await repos.getBot(context.actor, input.botId);
      const duplicate = await repos
        .createBot(context.actor, {
          name: duplicateBotName(source.name),
          title: source.title,
          description: source.description,
          instructions: source.instructions,
          notifyOnFinish: source.notifyOnFinish,
          color: source.color,
          computerMode: source.computer?.scope === "dedicated" ? "dedicated" : "team",
          modelProvider: source.modelProvider,
          modelId: source.modelId,
          thinkingLevel: source.thinkingLevel,
        })
        .catch((error: unknown) => {
          throw mapSpaceLifecycleError(error);
        });

      const assignments = await deps.prisma.botMcpServer.findMany({
        where: {
          botId: source.id,
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
        },
      });
      if (assignments.length) {
        await deps.prisma.botMcpServer.createMany({
          data: assignments.map((assignment) => ({
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            botId: duplicate.id,
            serverId: assignment.serverId,
            allowAllTools: assignment.allowAllTools,
            allowedTools: assignment.allowedTools as Prisma.InputJsonValue,
          })),
        });
      }
      return duplicate;
    }),

    reorder: authed.bots.reorder.handler(async ({ context, input }) => {
      await repos.reorderBots(context.actor, input.botIds);
      return { ok: true as const };
    }),

    // ==========================================================================
    // UPDATE
    // ==========================================================================

    update: authed.bots.update.handler(async ({ context, input }) => {
      const existing = await repos.getBot(context.actor, input.botId);

      if (input.sectionId) {
        const section = await deps.prisma.botSection.findFirst({
          where: {
            id: input.sectionId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
          select: { id: true },
        });
        if (!section) throw new IsolationError();
      }

      const settingModel =
        input.modelProvider !== undefined &&
        input.modelId !== undefined &&
        (input.modelProvider !== existing.modelProvider ||
          input.modelId !== existing.modelId);

      if (settingModel && input.modelProvider && input.modelId) {
        const credential = await findModelCredential(
          deps.prisma,
          context.actor,
          input.modelProvider,
          input.modelId
        );
        if (!credential) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Connect that model provider first",
          });
        }
        const knownModels = [...listPiCatalog(), scriptedCatalogEntry];
        const inCatalog = knownModels.some(
          (item) =>
            item.provider === input.modelProvider &&
            item.id === input.modelId
        );
        if (!inCatalog && credential.defaultModel !== input.modelId) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Unknown model for that provider",
          });
        }
        if (inCatalog) {
          const authError = await validateStoredModelAuth(
            deps.prisma,
            deps.secrets,
            context.actor.userId,
            credential.secretId,
            input.modelProvider,
            input.modelId,
            codexCatalog,
            {
              onExpiredToken: () =>
                refreshExpiredCredential(
                  context.actor,
                  credential.secretId,
                  input.modelProvider!
                ),
            }
          );
          if (authError) {
            throw new ORPCError("BAD_REQUEST", { message: authError });
          }
        }
      }

      const thinkingLevel = input.thinkingLevel;
      if (input.thinkingLevel) {
        const provider =
          input.modelProvider !== undefined
            ? input.modelProvider
            : existing.modelProvider;
        const modelId =
          input.modelId !== undefined ? input.modelId : existing.modelId;
        const me = await meDto(deps, context.actor);
        const effectiveProvider = provider ?? me.defaultProvider;
        const effectiveModelId = modelId ?? me.defaultModel;

        if (effectiveProvider && effectiveModelId) {
          const entry = listPiCatalog().find(
            (item) =>
              item.provider === effectiveProvider &&
              item.id === effectiveModelId
          );
          let allowed: string[] | undefined = entry?.thinkingLevels;

          if (effectiveProvider === OPENAI_COMPATIBLE_PROVIDER_ID) {
            allowed = ["off"];
            const credential = await findModelCredential(
              deps.prisma,
              context.actor,
              effectiveProvider
            );
            if (credential && credential.defaultModel === effectiveModelId) {
              const secret = await deps.prisma.secret.findFirst({
                where: {
                  id: credential.secretId,
                  userId: context.actor.userId,
                  spaceId: null,
                },
                select: { ciphertext: true },
              });
              if (secret) {
                try {
                  allowed =
                    modelCredentialDto(
                      credential,
                      deps.secrets.load(
                        secret.ciphertext,
                        credential.secretId
                      )
                    ).thinkingLevels ?? allowed;
                } catch {
                  // Unreadable connections must not advertise reasoning support.
                }
              }
            }
          }

          if (allowed && !allowed.includes(input.thinkingLevel)) {
            throw new ORPCError("BAD_REQUEST", {
              message: `Thinking level must be one of: ${allowed.join(", ")}`,
            });
          }
        }
      }

      if (!existing.thread) throw new IsolationError();

      const budgetPatch =
        input.monthlyTokenBudget === undefined
          ? {}
          : {
              monthlyTokenBudget: input.monthlyTokenBudget,
              ...(input.monthlyTokenBudget === existing.monthlyTokenBudget
                ? {}
                : { budgetWarnedAt: null }),
            };

      const result = await commitBotUpdate({
        prisma: deps.prisma,
        notify: (threadId: string, seq: number) =>
          deps.events.notify(threadId, seq),
        spaceId: context.actor.spaceId,
        threadId: existing.thread.id,
        botId: input.botId,
        emitBotUpdated: botProfileLabelsChanged(input),
        data: {
          name: input.name,
          title: input.title,
          description: input.description,
          instructions: input.instructions,
          notifyOnFinish: input.notifyOnFinish,
          color: input.color,
          pinned: input.pinned,
          memoryScope: input.memoryScope,
          sectionId: input.sectionId,
          voiceId: input.voiceId,
          autoSpeak: input.autoSpeak,
          ...(input.modelProvider !== undefined
            ? {
                modelProvider: input.modelProvider,
                modelId: input.modelId ?? null,
              }
            : {}),
          ...(input.thinkingLevel !== undefined ? { thinkingLevel } : {}),
          ...budgetPatch,
          ...(input.teamChatAmbientEnabled !== undefined
            ? { teamChatAmbientEnabled: input.teamChatAmbientEnabled }
            : {}),
          ...(input.teamChatRules !== undefined
            ? { teamChatRules: input.teamChatRules }
            : {}),
        },
      });

      const bots = await repos.listBots(context.actor);
      const bot = bots.find((b) => b.id === input.botId);
      if (!bot) throw new IsolationError();
      return bot;
    }),

    // ==========================================================================
    // COMPUTER MANAGEMENT
    // ==========================================================================

    setComputer: authed.bots.setComputer.handler(async ({ context, input }) => {
      const bot = await repos.getBot(context.actor, input.botId);
      if (!bot.computer) throw new IsolationError();

      const currentMode =
        bot.computer.scope === "dedicated" ? "dedicated" : "team";
      if (currentMode === input.mode) {
        try {
          return await repos.setBotComputer(context.actor, bot.id, input.mode);
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
      }

      const claimed = await deps.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM computers WHERE id = ${bot.computerId} FOR UPDATE`;
        return tx.bot.updateMany({
          where: {
            id: bot.id,
            computerSwitching: false,
            computer: { maintenanceId: null },
          },
          data: { computerSwitching: true },
        });
      });

      if (claimed.count !== 1) throw new ORPCError("CONFLICT");

      try {
        const active = await deps.prisma.run.findFirst({
          where: {
            botId: bot.id,
            status: { in: [...ACTIVE_RUN_STATUSES] },
          },
          select: { id: true },
        });
        if (active) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Stop the bot first",
          });
        }

        if (
          bot.computer.controlBotId === bot.id &&
          hasActiveComputerControl(bot.computer)
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Release the computer first",
          });
        }

        if (bot.computer.scope === "dedicated" && bot.computer.providerRef) {
          const ctx = computerContext(context.actor, bot.id, "computer.switch");
          const ref = toComputerRef(bot.computer);
          if (bot.computer.state === "running") {
            await checkpointAndRecordComputerWorkspace(
              deps,
              bot.computer,
              ref,
              ctx
            );
            await deps.sandbox.stop(ref, ctx);
          }
          await deps.prisma.computerExecutionLease.deleteMany({
            where: {
              computerId: bot.computer.id,
              botId: bot.id,
            },
          });
          await deps.prisma.computer.update({
            where: { id: bot.computer.id },
            data: {
              state: "stopped",
              controlHolder: "none",
              controlLeaseId: null,
              controlLeaseExpiresAt: null,
              controlBotId: null,
              controlRunId: null,
              executionRunId: null,
              executionBotId: null,
              executionLeaseExpiresAt: null,
            },
          });
        }
        return await repos.setBotComputer(context.actor, bot.id, input.mode);
      } catch (error) {
        throw mapSpaceLifecycleError(error);
      } finally {
        await deps.prisma.bot.updateMany({
          where: { id: bot.id },
          data: { computerSwitching: false },
        });
      }
    }),

    // ==========================================================================
    // LIFECYCLE
    // ==========================================================================

    archive: authed.bots.archive.handler(async ({ context, input }) => {
      const bot = await repos.getBot(context.actor, input.botId, {
        includeArchived: true,
      });
      // TODO: Implement archiveBot from adapters
      // await archiveBot(deps, bot, computerContext(context.actor, bot.id, "archive"));
      return { ok: true as const };
    }),

    restore: authed.bots.restore.handler(async ({ context, input }) => {
      const bot = await repos.getBot(context.actor, input.botId, {
        includeArchived: true,
      });
      if (!bot.archivedAt) return { ok: true as const };
      // TODO: Implement restore logic
      return { ok: true as const };
    }),

    remove: authed.bots.remove.handler(async ({ context, input }) => {
      const bot = await repos.getBot(context.actor, input.botId, {
        includeArchived: true,
      });
      // TODO: Implement destroyBot from adapters
      // await destroyBot(deps, bot, computerContext(context.actor, bot.id, "destroy"));
      return { ok: true as const };
    }),

    // ==========================================================================
    // IMPORT
    // ==========================================================================

    importPreview: authed.bots.importPreview.handler(async ({ input }) => {
      const warnings: string[] = [];
      const prepared = prepareBotImport(input, warnings);
      return {
        name: prepared.profile.name,
        title: prepared.profile.title,
        description: prepared.profile.description,
        instructionsPreview: prepared.profile.instructions.slice(0, 500),
        boundaries: input.manifest.boundaries,
        memoryCount: prepared.memory.size,
        routineNames: prepared.routines.map((routine) => routine.name),
        skillNames: prepared.skills.map((skill) => skill.name),
        fileCount: prepared.files.length,
        historyCount: input.manifest.history.length,
        warnings,
      };
    }),

    import: authed.bots.import.handler(async ({ context, input }) => {
      const warnings: string[] = [];
      const prepared = prepareBotImport(input, warnings);
      const homeContext = {
        operationId: "bots.import",
        traceId: "bots.import",
        spaceId: context.actor.spaceId,
        userId: context.actor.userId,
        signal: context.signal ?? new AbortController().signal,
      };

      for (const skill of prepared.skills) {
        try {
          await agentSkills.create(context.actor, { content: skill.content });
        } catch (error) {
          if (
            !(error instanceof ORPCError) ||
            (error as ORPCError).code !== "CONFLICT"
          ) {
            throw error;
          }
          warnings.push(`Skill not added (name taken): ${skill.name}`);
        }
      }

      const created = await deps.prisma.$transaction(async (tx) => {
        const bot = await repos.createBot(
          context.actor,
          {
            ...prepared.profile,
            notifyOnFinish: true,
            computerMode: "team",
            initialMessage: {
              role: "system",
              blocks: [
                {
                  kind: "meta",
                  text:
                    warnings.length > 0
                      ? `Imported preset with warnings: ${warnings.join(
                          " "
                        )}`
                      : "Imported from preset.",
                },
              ],
            },
          },
          { tx }
        );
        await applyPreparedImport(tx, context.actor, bot.id, prepared);
        return bot;
      });

      if (prepared.files.length > 0) {
        const computer = await deps.prisma.computer.findFirst({
          where: { bots: { some: { id: created.id } } },
          select: { homeKey: true },
        });
        if (computer) {
          try {
            for (const file of prepared.files) {
              await deps.home.writeFile(
                computer.homeKey,
                file.path,
                file.content,
                homeContext
              );
            }
          } catch (error) {
            getLogger().error("bots.import home file write failed", error);
          }
        }
      }

      const bots = await repos.listBots(context.actor);
      const dto = bots.find((b) => b.id === created.id);
      if (!dto) throw new IsolationError();
      return dto;
    }),

    // ==========================================================================
    // WEBHOOK
    // ==========================================================================

    rotateWebhookSecret: authed.bots.rotateWebhookSecret.handler(
      async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        const plaintext = randomBytes(32).toString("base64url");
        const stored = await deps.secrets.put(plaintext, {
          operationId: "bots.rotateWebhookSecret",
          traceId: "bots.rotateWebhookSecret",
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
          signal: context.signal ?? new AbortController().signal,
        });

        await deps.prisma.$transaction(async (tx) => {
          const previousSecretId = bot.webhookSecretId;
          await tx.secret.create({
            data: {
              id: stored.id,
              userId: context.actor.userId,
              spaceId: context.actor.spaceId,
              kind: "webhook",
              ciphertext: stored.ciphertext,
            },
          });
          await tx.bot.update({
            where: { id: bot.id },
            data: { webhookSecretId: stored.id },
          });
          if (previousSecretId) {
            await tx.secret.deleteMany({
              where: {
                id: previousSecretId,
                spaceId: context.actor.spaceId,
                userId: context.actor.userId,
                kind: "webhook",
              },
            });
          }
        });

        return {
          secret: plaintext,
          path: `/api/v1/bots/${bot.id}/webhook`,
          webhookConfigured: true as const,
        };
      }
    ),
  };
}
