/**
 * The prefix this build reads its deployment settings from.
 */
export const ENV_PREFIX = "BOBBOT_";

/**
 * The prefix earlier releases used. Nothing reads these names directly any more.
 */
export const LEGACY_ENV_PREFIX = "RAKAZO_";

/**
 * Copies every legacy variable onto its new name, so a deployment that still
 * sets only the old names keeps working. The new name wins when both are set,
 * which lets an operator move one variable at a time.
 */
export function applyLegacyEnvAliases(env: NodeJS.ProcessEnv = process.env): string[] {
  const aliased: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.startsWith(LEGACY_ENV_PREFIX)) continue;
    const renamed = `${ENV_PREFIX}${name.slice(LEGACY_ENV_PREFIX.length)}`;
    if (env[renamed] === undefined) {
      env[renamed] = value;
      aliased.push(renamed);
    }
  }
  return aliased;
}
