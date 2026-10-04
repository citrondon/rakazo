import { redactSecrets } from "@rakazo/core";

export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => Boolean(signal)));
}

const USER_ERROR_MAP: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /stdio MCP in the sandbox needs a bot identity/,
    message:
      "MCP stdio: bot has no identity (botId missing). Assign the bot to an agent computer first.",
  },
  {
    pattern: /Bot has no computer/,
    message:
      "This bot has no computer assigned — configure a computer for the bot before using MCP stdio.",
  },
  {
    pattern: /this computer provider cannot host a stdio process/,
    message: "This computer provider cannot host a stdio process — use E2B or Docker.",
  },
  {
    pattern:
      /MCP stdio runs in the bot's computer, but this deployment gave no computer resolver or process opener/,
    message:
      "MCP stdio is enabled but this deployment has no computer resolver or process opener wired up.",
  },
];

function mapConnectorUserError(message: string): string {
  for (const { pattern, message: mapped } of USER_ERROR_MAP) {
    if (pattern.test(message)) return mapped;
  }
  return message;
}

export function sanitizeConnectorError(error: unknown, secrets: string[] = []): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(
    mapConnectorUserError(message)
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/trg_(?:live|test)_[A-Za-z0-9_-]+/g, "[redacted]"),
    secrets,
  ).slice(0, 2_000);
}

export function redactConnectorPayload(value: unknown, secrets: string[]): unknown {
  if (secrets.length === 0) return value;
  try {
    return redactPayloadValue(JSON.parse(JSON.stringify(value)), secrets);
  } catch {
    return { ok: true };
  }
}

function redactPayloadValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactPayloadValue(item, secrets));
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    const serialized = String(value);
    return redactSecrets(serialized, secrets) === serialized ? value : "[redacted]";
  }
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      redactSecrets(key, secrets),
      redactPayloadValue(item, secrets),
    ]),
  );
}
