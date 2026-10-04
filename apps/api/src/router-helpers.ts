/**
 * Router Helper Functions
 * 
 * Extracted from router.ts to improve maintainability.
 * These are the most commonly used helper functions.
 */

import { ORPCError } from "@orpc/server";
import type { Actor, Bot, McpServer } from "@rakazo/contracts";
import type { AdapterContext } from "@rakazo/adapter-kit";
import {
  SpaceDeletionInProgressError,
  ComputerLimitError,
} from "@rakazo/db";

// ============================================================================
// SIMPLE HELPERS (No dependencies)
// ============================================================================

/**
 * Generate a unique name for a duplicated bot
 */
export function duplicateBotName(name: string): string {
  return `${name.slice(0, 75)} copy`;
}

// ============================================================================
// CONTEXT HELPERS (Depend on Actor type)
// ============================================================================

/**
 * Create an adapter context for computer operations
 */
export function computerContext(
  actor: Actor,
  botId: string,
  operationId: string
): AdapterContext {
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
 * Create an adapter context for connection operations
 */
export function connectionContext(
  actor: Actor,
  operationId: string,
  signal?: AbortSignal
): AdapterContext {
  return {
    operationId,
    traceId: operationId,
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal: signal ?? new AbortController().signal,
  };
}

// ============================================================================
// ERROR HELPERS (Depend on db types)
// ============================================================================

/**
 * Surface a Space deletion race as a retryable conflict instead of a generic failure.
 */
export function mapSpaceLifecycleError(error: unknown): unknown {
  if (error instanceof SpaceDeletionInProgressError) {
    return new ORPCError("CONFLICT", { message: error.message });
  }
  if (error instanceof ComputerLimitError) {
    return new ORPCError("BAD_REQUEST", { message: error.message });
  }
  return error;
}

// ============================================================================
// MCP HELPERS
// ============================================================================

/**
 * Map a database row to an MCP server DTO
 */
export function mcpServerDto(
  row: {
    id: string;
    spaceId: string;
    slug: string;
    name: string;
    description: string;
    transport: string;
    endpoint: string | null;
    command: string | null;
    args: unknown;
    env: unknown;
    headers: unknown;
    secretId: string | null;
    enabled: boolean;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
  },
  oauthStatus: McpServer["oauthStatus"] = "none"
): McpServer {
  const args = Array.isArray(row.args)
    ? row.args.filter((item): item is string => typeof item === "string")
    : [];
  const envKeys =
    row.env && typeof row.env === "object" && !Array.isArray(row.env)
      ? Object.keys(row.env)
      : [];
  const headerKeys =
    row.headers && typeof row.headers === "object" && !Array.isArray(row.headers)
      ? Object.keys(row.headers)
      : [];

  return {
    id: row.id,
    spaceId: row.spaceId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    transport: row.transport as McpServer["transport"],
    endpoint: row.endpoint,
    command: row.command,
    args,
    envKeys,
    headerKeys,
    hasSecret: row.secretId !== null,
    oauthStatus,
    enabled: row.enabled,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as any).code === "P2002"
  );
}

export function isRecordNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as any).code === "P2025"
  );
}
