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
    description:
      "Direkter Lese- und Schreibzugriff auf deinen synchronisierten Windows-Ordner (workspace/).",
    badge: "Empfohlen",
    iconName: "FolderKanban",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/rakazo/shared"],
  },
  {
    id: "workspace-exec",
    slug: "workspace-exec",
    name: "Terminal & Code Runner",
    description:
      "Führt Python-, Node- und Shell-Befehle direkt im geteilten Workspace aus (inklusive Tests).",
    badge: "Power",
    iconName: "Terminal",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-server-commands"],
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
    args: ["-y", "mcp-fetch-server"],
  },
  {
    id: "markdown-notes",
    slug: "markdown-notes",
    name: "Markdown Second Brain",
    description:
      "Verwaltet ein dauerhaftes Wissens- und Notizarchiv im Workspace (Obsidian-kompatibel).",
    badge: "Gedächtnis",
    iconName: "BookOpen",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/rakazo/shared/notes"],
  },
  {
    id: "sqlite-explorer",
    slug: "sqlite-explorer",
    name: "SQLite & Data Explorer",
    description:
      "Strukturierte SQL-Abfragen und Analysen für lokale SQLite-Datenbanken im Workspace.",
    badge: "Data",
    iconName: "Database",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-sqlite", "/home/rakazo/shared/data.db"],
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
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiresSecret: {
      label: "GitHub Personal Access Token",
      placeholder: "ghp_...",
      envVar: "GITHUB_PERSONAL_ACCESS_TOKEN",
    },
  },
];
