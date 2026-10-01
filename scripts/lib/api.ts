/**
 * Minimal oRPC client for operator scripts.
 *
 * These scripts used to open Postgres directly. That bypassed the API's permissions,
 * events, and model resolution — a script could write a run or a message that no user
 * could have created. They talk to a running API instead, so every call goes through
 * the same handlers a signed-in user would reach.
 *
 * Environment:
 *   RAKAZO_API_URL    Base URL of the API. Default: http://127.0.0.1:3100
 *   RAKAZO_API_TOKEN  A better-auth session token. The API accepts it as
 *                     `Authorization: Bearer <token>`, so no cookie jar is required.
 */
import type {
  Bot,
  CreateGroupInput,
  ExportManifest,
  Group,
  RunsListOutput,
  ThreadMessage,
  ThreadMessagePage,
} from "@rakazo/contracts";
import { isTerminal } from "@rakazo/core";

function apiBaseUrl(): string {
  return (process.env.RAKAZO_API_URL ?? "http://127.0.0.1:3100").replace(/\/+$/, "");
}

function authToken(): string {
  const token = process.env.RAKAZO_API_TOKEN;
  if (!token) {
    throw new Error(
      "RAKAZO_API_TOKEN is not set. Log in to the web app and export its better-auth session token.",
    );
  }
  return token;
}

/** POST one oRPC procedure and return its JSON payload. Throws on any error envelope. */
export async function rpc<Output>(procedure: string, input: unknown = {}): Promise<Output> {
  const base = apiBaseUrl();
  const response = await fetch(`${base}/rpc/${procedure}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      authorization: `Bearer ${authToken()}`,
    },
    body: JSON.stringify({ json: input }),
  });
  const text = await response.text();
  let parsed: { json?: Output; error?: { message?: string } } | undefined;
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // A non-JSON body (a proxy error page) falls through to the status check below.
  }
  if (!response.ok || parsed?.error) {
    throw new Error(`${procedure} failed ${response.status}: ${parsed?.error?.message ?? text}`);
  }
  return parsed?.json as Output;
}

export function listBots(): Promise<Bot[]> {
  return rpc<Bot[]>("bots/list");
}

export async function findBotByName(name: string): Promise<Bot> {
  const bots = await listBots();
  const bot = bots.find((candidate) => candidate.name === name);
  if (!bot) throw new Error(`No bot named "${name}" in this space.`);
  return bot;
}

export function listGroups(): Promise<Group[]> {
  return rpc<Group[]>("groups/list");
}

export async function findGroupByName(name: string): Promise<Group> {
  const groups = await listGroups();
  const group = groups.find((candidate) => candidate.name === name);
  if (!group) throw new Error(`No group named "${name}" in this space.`);
  return group;
}

export function createGroup(input: CreateGroupInput): Promise<Group> {
  return rpc<Group>("groups/create", input);
}

/** Create a bot from a shipped preset by slug, through the API's transactional import. */
export function importPreset(slug: string): Promise<Bot> {
  return rpc<ExportManifest>("bots/preset", { slug }).then((manifest) =>
    rpc<Bot>("bots/import", { manifest }),
  );
}

type ThreadTarget = { botId?: string; groupId?: string };

/** Send a message to a bot or group thread and return the run it started. */
export function sendToThread(
  target: ThreadTarget & { text: string; mentions?: string[] },
): Promise<{ taskId: string; runId: string; seq: number }> {
  return rpc("threads/send", {
    ...target,
    clientNonce: `script:${target.botId ?? target.groupId}:${Date.now()}`,
  });
}

/** Poll the recent-runs list until the run reaches a terminal status. */
export async function waitForRun(
  runId: string,
  { timeoutMs = 180_000, intervalMs = 3_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<RunsListOutput["runs"][number]> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { runs } = await rpc<RunsListOutput>("runs/list", { filter: "recent" });
    const run = runs.find((candidate) => candidate.runId === runId);
    if (run && isTerminal(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for run ${runId}`);
}

/** The text of the most recent bot reply in a thread, or null when there is none. */
export async function latestReply(target: ThreadTarget): Promise<string | null> {
  const page = await rpc<ThreadMessagePage>("threads/messages", target);
  const reply = [...page.messages].reverse().find((message) => message.role === "bot");
  return reply ? messageText(reply) : null;
}

export function messageText(message: ThreadMessage): string | null {
  const block = message.blocks.find((candidate) => candidate.kind === "text");
  return block && block.kind === "text" ? block.text : null;
}
