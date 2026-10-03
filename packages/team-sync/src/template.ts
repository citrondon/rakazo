import {
  AgentSkill,
  type BotRole,
  type McpServerConfigInput,
  type Routine,
} from "@rakazo/contracts";

export interface TeamTemplate {
  version: string;
  roles: BotRole[];
  skills: Array<{ name: string; version: string; source: string }>;
  routines: Array<
    Omit<Routine, "id" | "botId" | "createdAt" | "updatedAt"> & { template: boolean }
  >;
  mcpServers: McpServerConfigInput[];
  policies: { approval: object; security: object };
  computerDefaults: { kind: "docker" | "desktop"; cpu: number; memory: number };
}

export const TeamTemplateSchema = {
  version: "1.0",
  type: "object",
  properties: {
    version: { type: "string" },
    roles: { type: "array" },
    skills: { type: "array" },
    routines: { type: "array" },
    mcpServers: { type: "array" },
    policies: { type: "object" },
    computerDefaults: { type: "object" },
  },
  required: [
    "version",
    "roles",
    "skills",
    "routines",
    "mcpServers",
    "policies",
    "computerDefaults",
  ],
} as const;
