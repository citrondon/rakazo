import type { McpStdioStatus } from "@rakazo/contracts";

export interface McpPreset {
  id: string;
  slug: string;
  name: string;
  description: string;
  badge?: string;
  iconName: "FolderKanban" | "Globe" | "BookOpen" | "GitBranch" | "Terminal" | "Database";
  transport: "stdio";
  command: string;
  args: string[];
  requiresSecret?: {
    label: string;
    placeholder: string;
    envVar: string;
  };
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "workspace-files",
    slug: "workspace-files",
    name: "Workspace Files",
    description: "Direkter Lese- und Schreibzugriff auf das Home-Verzeichnis dieses Bots ({home}).",
    badge: "Empfohlen",
    iconName: "FolderKanban",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "{home}"],
  },
  {
    id: "workspace-exec",
    slug: "workspace-exec",
    name: "Terminal & Code Runner",
    description:
      "Führt Befehle im Server-Prozess aus, nicht im Sandbox-Container des Bots. Nur mit bedachtem Allowlist-Eintrag.",
    badge: "Power",
    iconName: "Terminal",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-server-commands@0.8.2"],
  },
  {
    id: "web-fetch",
    slug: "web-fetch",
    name: "Web-Recherche & Fetch",
    description:
      "Liest Webseiten & Online-Dokumente blitzschnell als Markdown aus (ohne Browser-Overhead).",
    badge: "Schnell",
    iconName: "Globe",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-fetch-server@1.1.2"],
  },
  {
    id: "markdown-notes",
    slug: "markdown-notes",
    name: "Markdown Second Brain",
    description:
      "Verwaltet ein dauerhaftes Wissens- und Notizarchiv dieses Bots (Obsidian-kompatibel).",
    badge: "Gedächtnis",
    iconName: "BookOpen",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "{home}/notes"],
  },
  {
    id: "sqlite-explorer",
    slug: "sqlite-explorer",
    name: "SQLite & Data Explorer",
    description:
      "Strukturierte SQL-Abfragen auf einer SQLite-Datenbank im Home-Verzeichnis dieses Bots.",
    badge: "Data",
    iconName: "Database",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-sqlite@1.0.9", "{home}/data.db"],
  },
  {
    id: "github",
    slug: "github",
    name: "GitHub Connect",
    description: "Code durchsuchen, Commits, Pull Requests und Issues erstellen.",
    badge: "Code",
    iconName: "GitBranch",
    transport: "stdio",
    command: "npx",
    // Deprecated upstream and archived; kept pinned for compatibility. Prefer a
    // remote GitHub MCP connector with OAuth when this deployment offers one.
    args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"],
    requiresSecret: {
      label: "GitHub Personal Access Token",
      placeholder: "ghp_...",
      envVar: "GITHUB_PERSONAL_ACCESS_TOKEN",
    },
  },
];

/** Why this preset cannot start yet. Null when it would run, and while the deployment
 * capability is still loading. The wording lives in <McpPresetBlockerNote />. */
export function stdioBlockerReason(
  preset: McpPreset,
  status: McpStdioStatus | null,
): "disabled" | "command" | null {
  if (!status) return null;
  if (!status.enabled) return "disabled";
  return status.allowedCommands.includes(preset.command) ? null : "command";
}
