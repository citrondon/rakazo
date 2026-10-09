/**
 * BobBot <-> CopilotKit AG-UI Adapter Barrel
 *
 * Dieses Modul bridge das BobBot AG-UI Protokoll zu CopilotKit's
 * implementierten UI-Patterns. Es liegt vollständig hinter den
 * BobBot-Verträgen (@rakazo/contracts), damit keine Abhängigkeit
 * nach CopilotKit in den Kern übergeht.
 *
 * Usage:
 *   const adapter = createRakizoCopilotKitAdapter({
 *     contract: yourRakazoContract,
 *     provider: yourPreferredLLMProvider,
 *     computerIntegration: yourSandboxIntegration,
 *   })
 */

export * from "./adapter";
export * from "./types";
