import type { CopilotKitAdapter as BaseCopilotKitAdapter } from "@copilotkit/adaptor";
import type {
  AgentRuntime,
  MessagingSurface,
  SandboxProvider,
  TriggerEvent,
} from "@rakazo/adapter-kit";
import type {
  BotMessageIntent,
  ComputerCommand,
  MessageBlock,
  ProductEventType,
} from "@rakazo/contracts";

// Importiere die Typen aus diesem Modul
import type { CopilotKitMessageBlock } from "./types";
import { mapToCopilotKitBlock, mapToCopilotKitEventType, TrustEffect } from "./types";

interface RakizoCopilotKitAdapterOptions {
  /** Dein BobBot Agent Runtime (enthält State, Speicher, Provider-Config) */
  agentRuntime: AgentRuntime;
  /** Dein bevorzugter LLM Provider (OpenAI, Anthropic, lokal etc.) */
  llmProvider: {
    generate: (messages: any[], tools?: any[]) => Promise<any>;
    streamGenerate?: (messages: any[], tools?: any[]) => AsyncGenerator<any>;
  };
  /** Deine Computer/Sandbox Integration (Docker-Supervisor etc.) */
  computerIntegration: {
    executeCommand: (
      command: string,
      cwd?: string,
    ) => Promise<{ exitCode: number; output: string }>;
    getScreenshot?: () => Promise<string | null>;
    getFileContents?: (path: string) => Promise<string | null>;
  };
  /** Optionales Messaging-Surface (Slack, Discord, WebUI etc.) */
  messagingSurface?: MessagingSurface;
}

/**
 * Haupt-Adapter-Factory: Erstellt einen CopilotKit-Adapter, der hinter
 * deinen BobBot-Verträgen liegt und deine autonome Workflows nutzt.
 */
export function createRakizoCopilotKitAdapter(
  options: RakizoCopilotKitAdapterOptions,
): BaseCopilotKitAdapter {
  const { agentRuntime, llmProvider, computerIntegration, messagingSurface } = options;

  // Hilfsfunktion: Extrahiert den Bot-Namen aus dem Runtime-Zustand
  const getBotName = (): string => agentRuntime.bot?.name ?? "RakazoBot";

  // Hilfsfunktion: Mappt einen BobBot MessageBlock zu CopilotKit Format
  const mapBlock = (block: MessageBlock): CopilotKitMessageBlock => mapToCopilotKitBlock(block);

  // Hilfsfunktion: Sendet eine Nachricht an die Messaging-Oberfläche
  const sendMessage = async (message: any) => {
    if (messagingSurface && messagingSurface.send) {
      await messagingSurface.send(message);
    }
    // Fallback: In agentRuntime Kontext speichern
    agentRuntime.memory?.revise({
      path: "recent_messages",
      content: [message],
    });
  };

  // Hilfsfunktion: Führt einen Computer-Befehl aus via deiner Sandbox
  const executeComputerCommand = async (
    command: string,
    cwd?: string,
  ): Promise<{ exitCode: number; output: string }> => {
    return computerIntegration.executeCommand(command, cwd);
  };

  // Hilfsfunktion: Holt Screenshot via Sandbox (falls unterstützt)
  const fetchScreenshot = async (): Promise<string | null> => {
    if (computerIntegration.getScreenshot) {
      return computerIntegration.getScreenshot();
    }
    return null;
  };

  // ––––––––––––––––––––––––––––––––––––––––––––––––––
  // Core: LLM Generation mit deiner Provider-Logik
  // ––––––––––––––––––––––––––––––––––––––––––––––––––

  const generateResponse = async (messages: any[]) => {
    const response = await llmProvider.generate(messages);
    return response;
  };

  // ––––––––––––––––––––––––––––––––––––––––––––––––––
  // Core: Tool/Command Execution via deine Sandbox
  // ––––––––––––––––––––––––––––––––––––––––––––––––––

  const executeTool = async (toolName: string, toolInput: any) => {
    // Mappe Tool-Namen zu Computer-Kommandos
    const commandMap: Record<string, string> = {
      shell: `cd ${cwd ?? agentRuntime.computer?.workingDirectory ?? "."} && ${JSON.stringify(toolInput.command)}`,
      run_code: `cd ${cwd ?? "."} && ${JSON.stringify(toolInput.code)}`,
      read_file: `cat ${JSON.stringify(toolInput.path)}`,
      write_file: `cat > ${JSON.stringify(toolOutput.path)} << 'EOF'\n${JSON.stringify(toolInput.content)}\nEOF`,
      list_directory: `ls -la ${JSON.stringify(toolInput.path ?? ".")}`,
    };

    const command = commandMap[toolName] || `echo "Unknown tool: ${toolName}"`;
    const result = await executeComputerCommand(command);

    return {
      exitCode: result.exitCode,
      output: result.output,
    };
  };

  // ––––––––––––––––––––––––––––––––––––––––––––––––––
  // UI: Progress & State Reporting
  // ––––––––––––––––––––––––––––––––––––––––––––––––––

  const reportProgress = async (progress: {
    text: string;
    activity?: string;
    pendingToolNames?: string[];
  }) => {
    await sendMessage({
      kind: "progress",
      text: progress.text,
      activity: progress.activity,
      pendingToolNames: progress.pendingToolNames,
    });
  };

  // ––––––––––––––––––––––––––––––––––––––––––––––––––
  // Exported: BaseCopilotKitAdapter Interface Implementation
  // ––––––––––––––––––––––––––––––––––––––––––––––––––

  return {
    // CopilotKit expects these core functions
    generate: generateResponse,
    stream: llmProvider.streamGenerate
      ? async function* (messages: any[]) {
          yield* llmProvider.streamGenerate(messages);
        }
      : undefined,

    // UI Mapping für Message Blöcke
    mapBlock,

    // Computer Integration Zugriff
    executeTool,

    // Progress Reporting
    reportProgress,

    // Screenshot Zugriff
    fetchScreenshot,

    // Event Typ Mapping
    mapEventType: mapToCopilotKitEventType,

    // Bot Identität
    getBotName,

    // Messaging Surface Integration
    sendMessage,

    // Trust Effect für Approval Cards
    createTrustEffect: createTrustEffectForCopilotKit,

    // Agent Runtime Zugriff (für erweiterte Cases)
    getAgentRuntime: () => agentRuntime,
  };
}

/**
 * Convenience Factory für gängige Setup-Szenarien.
 *
 * Beispiel für Docker-Sandbox Integration:
 * ```typescript
 * const adapter = createRakizoCopilotKitAdapter({
 *   agentRuntime: myAgentRuntime,
 *   llmProvider: {
 *     generate: async (messages) => {
 *       // Deine bestehende LLM Call Logik
 *       return await yourLLMCall(messages)
 *     }
 *   },
 *   computerIntegration: {
 *     executeCommand: async (cmd) => {
 *       // Dein Docker Sandbox Befehl-Logging
 *       return await yourSandboxSupervisor.execute(cmd)
 *     }
 *   }
 * })
 * ```
 */
export { createRakizoCopilotKitAdapter };
