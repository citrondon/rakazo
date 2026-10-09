import type {
  BotMessageIntent,
  ComputerCommandKind,
  MessageBlock,
  ProductEventType,
  TrustEffect,
} from "@bobbot/contracts"

// –––––––––––––––––––––––––––––––––––––––––––––––––––
// 1. MessageBlock Mapping
// –––––––––––––––––––––––––––––––––––––––––––––––––––

/**
 * Mapping von BobBot MessageBlock nach CopilotKit Format.
 * CopilotKit erwartet eine vereinfachte Struktur für seine Chat-Komponenten.
 */
export type CopilotKitMessageBlock =
  | { kind: "text"; text: string }
  | { kind: "card"; lines: { k: string; v: string }[] }
  | {
      kind: "ask"
      text: string
      /** Der engine-derived action summary attached to this exact approval effect. */
      effect?: {
        action: TrustEffect["action"]
        target: string
      }
      detail?: string
      input?: "text" | "secret"
      purpose?: "otp" | "password" | "api_key"
    }
  | {
      kind: "choice"
      question: string
      options: { id: string; label: string }[]
    }
  | { kind: "progress"; text: string; pendingToolNames?: string[] }
  | { kind: "steps"; steps: { label: string; count: number }; durationMs?: number }
  | { kind: "subagent"; agentId: string; name: string; task: string; status: string; progress?: string }
  | { kind: "image"; artifactId: string; mimeType: string; name: string }
  | { kind: "file"; artifactId: string; mimeType: string; name: string; size: number }
  | { kind: "handoff"; fromBotId: string; toBotId: string; text: string; hop?: number }
  | { kind: "bot_message_sent"; toBotId: string; toBotName: string; text: string; intent?: string }
  | { kind: "bot_message_received"; fromBotId: string; fromBotName: string; text: string; intent?: string; returnToMessageId?: string; hop?: number }

/**
 * Erzeugt ein CopilotKit MessageBlock aus einem BobBot MessageBlock.
 * Pure Funktion, keine I/O, deterministisch.
 */
export function mapToCopilotKitBlock(
  block: MessageBlock
): CopilotKitMessageBlock {
  switch (block.kind) {
    case "text":
      return { kind: "text", text: block.text }
    case "card":
      return { kind: "card", lines: block.lines }
    case "ask": {
      const base: any = {
        kind: "ask",
        text: block.text,
        detail: block.detail,
        input: block.input as "text" | "secret",
        purpose: block.purpose as "otp" | "password" | "api_key",
      }
      if (block.approvalEffectId) {
        // Hol den TrustEffect aus dem Engine-Zustand
        // (In der Praxis würde hier der Context/State übergeben werden)
        base.effect = {
          action: "update" as TrustEffect["action"],
          target: "unknown",
        }
      }
      return base
    }
    case "choice":
      return {
        kind: "choice",
        question: block.question,
        options: block.options.map((o) => ({
          id: o.id,
          label: o.label,
        })),
      }
    case "progress":
      return {
        kind: "progress",
        text: block.text,
        pendingToolNames: block.pendingToolNames,
      }
    case "steps":
      return {
        kind: "steps",
        steps: block.steps.map((s) => ({
          label: s.label,
          count: s.count,
        })),
        durationMs: block.durationMs,
      }
    case "subagent":
      return {
        kind: "subagent",
        agentId: block.agentId,
        name: block.name,
        task: block.task,
        status: block.status,
        progress: block.progress ?? "",
      }
    case "image":
      return {
        kind: "image",
        artifactId: block.artifactId,
        mimeType: block.mimeType,
        name: block.name,
      }
    case "file":
      return {
        kind: "file",
        artifactId: block.artifactId,
        mimeType: block.mimeType,
        name: block.name,
        size: block.size,
      }
    case "handoff":
      return {
        kind: "handoff",
        fromBotId: block.fromBotId,
        toBotId: block.toBotId,
        text: block.text,
        hop: block.hop,
      }
    case "bot_message_sent":
      return {
        kind: "bot_message_sent",
        toBotId: block.toBotId,
        toBotName: block.toBotName,
        text: block.text,
        intent: block.intent,
      }
    case "bot_message_received":
      return {
        kind: "bot_message_received",
        fromBotId: block.fromBotId,
        fromBotName: block.fromBotName,
        text: block.text,
        intent: block.intent,
        returnToMessageId: block.returnToMessageId,
        hop: block.hop,
      }
    default:
      // Fallback: Text rendern
      return { kind: "text", text: String(block.kind) }
  }
}

// –––––––––––––––––––––––––––––––––––––––––––––––––––
// 2. ProductEventType Mapping
// –––––––––––––––––––––––––––––––––––––––––––––––––––

/**
 * Mapping von BobBot ProductEventType nach CopilotKit Event Types.
 * CopilotKit nutzt ein eigenes Event-System für seine UI-Interaktionen.
 */
export type CopilotKitEventType =
  | "thread.message.created"
  | "thread.cleared"
  | "thread.message.updated"
  | "thread.progress"
  | "thread.ask"
  | "thread.choice"
  | "thread.meta"
  | "thread.computer"
  | "subagent.start"
  | "subagent.completed"
  | "subagent.failed"

export function mapToCopilotKitEventType(
  type: ProductEventType
): CopilotKitEventType {
  switch (type) {
    case "thread.message.created":
      return "thread.message.created"
    case "thread.cleared":
      return "thread.cleared"
    case "thread.message.updated":
      return "thread.message.updated"
    case "thread.progress":
      return "thread.progress"
    case "thread.ask":
      return "thread.ask"
    case "thread.choice":
      return "thread.choice"
    case "thread.meta":
      return "thread.meta"
    case "thread.computer":
      return "thread.computer"
    case "subagent.start":
      return "subagent.start"
    case "subagent.completed":
      return "subagent.completed"
    case "subagent.failed":
      return "subagent.failed"
    default:
      return "thread.meta"
  }
}

// –––––––––––––––––––––––––––––––––––––––––––––––––––
// 3. ComputerCommand Mapping
// –––––––––––––––––––––––––––––––––––––––––––––––––––

export type ComputerCommandKind =
  | "shell"
  | "write_file"
  | "attach_file"
  | "open_path"
  | "launch_app"

export function mapToCopilotKitCommandKind(
  kind: ComputerCommandKind
): "shell" | "write_file" | "attach_file" | "open_path" | "launch_app" {
  const map: Record<ComputerCommandKind, "shell" | "write_file" | "attach_file" | "open_path" | "launch_app"> = {
    shell: "shell",
    write_file: "write_file",
    attach_file: "attach_file",
    open_path: "open_path",
    launch_app: "launch_app",
  }
  return map[kind]
}

// –––––––––––––––––––––––––––––––––––––––––––––––––––
// 4. TrustEffect Mapping (für Ask-Karten)
// –––––––––––––––––––––––––––––––––––––––––––––––––––

export type TrustEffect = {
  action: "read" | "write" | "delete" | "publish"
  target: string
  risk: "low" | "medium" | "high"
}

/**
 * Erstellt einen TrustEffect-Proxy für CopilotKit's Approval Cards.
 * Zeigt dem Nutzer an, welche Aktion ausgeführt wird und mit welchem Risiko.
 */
export function createTrustEffectForCopilotKit(
  effect: TrustEffect
): {
  label: string
  destructive: boolean
  approval: {
    id: string
    handler: (outcome: "created" | "cancelled") => void
  }
} {
  const destructiveMap: Record<TrustEffect["action"], boolean> = {
    read: false,
    write: true,
    delete: true,
    publish: true,
  }

  return {
    label: `${effect.action.toUpperCase()} auf "${effect.target}"`,
    destructive: destructiveMap[effect.action],
    approval: {
      id: `${effect.action}-${effect.target}-${Date.now()}`,
      handler: (outcome) => {
        // Wird von CopilotKit aufgerufen, further processing
        // geschieht in deinem BobBot Run Executor
      },
    },
  }