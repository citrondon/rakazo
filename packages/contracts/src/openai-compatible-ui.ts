export const OPENAI_COMPATIBLE_BASE_URL_HINT =
  "Paste the OpenAI-compatible address from your server. BobBot adds /v1 if needed.";

/** Connect when base URL and model id are set. */
export function openAiCompatibleConnectReady(input: { baseUrl: string; modelId: string }): boolean {
  return Boolean(input.baseUrl.trim() && input.modelId.trim());
}

export function openAiCompatibleProbeSuccessMessage(modelCount: number): string {
  return modelCount
    ? `Found ${modelCount} model${modelCount === 1 ? "" : "s"}.`
    : "Server found. Enter a model name.";
}

/** Models covered under SpooK API Token Packs (Prepaid / 90% discount). */
export const SPOOK_TOKEN_PACK_MODELS: ReadonlySet<string> = new Set([
  // Claude
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-fable-5",
  // DeepSeek
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  // OpenAI
  "gpt-5.6-fast",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.5",
  // Google
  "gemini-3.1-pro",
  "gemini-2.5-pro",
  // Alibaba & other open-weight / provider flagships
  "qwen3.7-max",
  "qwen3.6-plus",
  "glm-5.3",
  "glm-5.2",
  "kimi-k3",
  "grok-4.5",
  "cursor-fable-5",
]);

export function isTokenPackModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (
    SPOOK_TOKEN_PACK_MODELS.has(normalized) ||
    normalized.startsWith("claude-") ||
    normalized.startsWith("deepseek-") ||
    normalized.startsWith("gpt-") ||
    normalized.startsWith("gemini-") ||
    normalized.startsWith("qwen") ||
    normalized.startsWith("glm-") ||
    normalized.startsWith("kimi-") ||
    normalized.startsWith("grok-") ||
    normalized.startsWith("cursor-")
  );
}

export function formatOpenAiCompatibleModelLabel(modelId: string): string {
  const trimmed = modelId.trim();
  if (isTokenPackModel(trimmed)) {
    return `${trimmed}  📦 [Token-Paket]`;
  }
  return trimmed;
}

/** Sorts models so that top Token-Pack models (especially claude-sonnet-5) are placed first. */
export function sortProbedModels(modelIds: readonly string[]): string[] {
  const priorityOrder: Record<string, number> = {
    "claude-sonnet-5": 1,
    "claude-sonnet-4-6": 2,
    "claude-opus-5-5": 3,
    "claude-opus-5": 4,
    "gpt-5.6-fast": 5,
    "deepseek-v4-flash": 6,
    "gemini-3.1-pro": 7,
    "qwen3.7-max": 8,
    "grok-4.5": 9,
  };

  return [...modelIds].sort((a, b) => {
    const aPriority = priorityOrder[a] ?? 100;
    const bPriority = priorityOrder[b] ?? 100;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.localeCompare(b);
  });
}
