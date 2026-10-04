/**
 * Rakazo <-> CopilotKit AG-UI Adapter Barrel
 *
 * Dieses Modul bridge das Rakazo AG-UI Protokoll zu CopilotKit's
 * implementierten UI-Patterns. Es liegt vollständig hinter den
 * Rakazo-Verträgen (@rakazo/contracts), damit keine Abhängigkeit
 * nach CopilotKit in den Kern übergeht.
 *
 * Usage:
 *   const adapter = createRakizoCopilotKitAdapter({
 *     contract: yourRakazoContract,
 *     provider: yourPreferredLLMProvider,
 *     computerIntegration: yourSandboxIntegration,
 *   })
 */

export * from './types'
export * from './adapter'