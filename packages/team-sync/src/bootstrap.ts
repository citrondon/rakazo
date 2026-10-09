import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotRoleRegistry } from "@bobbot/contracts";
import * as yaml from "yaml";
import type { TeamTemplate } from "./template.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class TeamBootstrapper {
  constructor(private roleRegistry: BotRoleRegistry) {}

  async bootstrap(repoUrl: string, teamName: string, targetDir: string): Promise<void> {
    // 1. Clone repo (shallow, depth=1, branch main)
    // For local paths, just copy; for URLs, use git clone
    const isLocal = !repoUrl.startsWith("http") && !repoUrl.startsWith("git@");
    const repoDir = isLocal ? repoUrl : await this.cloneRepo(repoUrl, targetDir);

    // 2. Load template.yaml from repoDir
    const templatePath = join(repoDir, "template.yaml");
    const templateContent = await fs.readFile(templatePath, "utf-8");
    const template = this.parseTemplate(templateContent);

    // 3. Validate template (basic validation)
    this.validateTemplate(template);

    // 4. Render template with placeholders (teamName, targetDir)
    // For now, template is just used as-is; roles/skills don't have placeholders

    // 5. Register roles in roleRegistry
    for (const role of template.roles) {
      this.roleRegistry.register(role);
    }

    // 6. Install skills (placeholder - would call skill install API)
    // await this.installSkills(template.skills);

    // 7. Write .rakazo/team-lock.json with pinned versions
    await this.writeLockFile(template, targetDir);

    // 8. Init queue worktrees structure
    await this.initQueueWorktrees(targetDir);
  }

  private async cloneRepo(repoUrl: string, targetDir: string): Promise<string> {
    // Placeholder for git clone - in real implementation would use simple-git or child_process
    // For now, assume repoUrl is a local path that was already cloned
    return repoUrl;
  }

  private parseTemplate(content: string): TeamTemplate {
    // Try YAML first, then JSON
    try {
      return yaml.parse(content) as TeamTemplate;
    } catch {
      try {
        return JSON.parse(content) as TeamTemplate;
      } catch (e) {
        throw new Error("Failed to parse template.yaml as YAML or JSON");
      }
    }
  }

  private validateTemplate(template: TeamTemplate): void {
    if (!template.version) throw new Error("Template missing version");
    if (!Array.isArray(template.roles)) throw new Error("Template missing roles array");
    if (!Array.isArray(template.skills)) throw new Error("Template missing skills array");
    if (!Array.isArray(template.routines)) throw new Error("Template missing routines array");
    if (!Array.isArray(template.mcpServers)) throw new Error("Template missing mcpServers array");
    if (!template.policies || !template.policies.approval || !template.policies.security) {
      throw new Error("Template missing policies (approval, security)");
    }
    if (!template.computerDefaults || !template.computerDefaults.kind) {
      throw new Error("Template missing computerDefaults.kind");
    }
  }

  private async writeLockFile(template: TeamTemplate, targetDir: string): Promise<void> {
    const lockDir = join(targetDir, ".rakazo");
    await fs.mkdir(lockDir, { recursive: true });

    const lockContent = {
      version: template.version,
      teamName: "", // Will be filled by caller
      skills: template.skills.map((s) => ({ name: s.name, version: s.version, source: s.source })),
      roles: template.roles.map((r) => r.id),
      mcpServers: template.mcpServers.length,
      routines: template.routines.length,
      computerDefaults: template.computerDefaults,
      generatedAt: new Date().toISOString(),
    };

    const lockPath = join(lockDir, "team-lock.json");
    await fs.writeFile(lockPath, JSON.stringify(lockContent, null, 2));
  }

  private async initQueueWorktrees(targetDir: string): Promise<void> {
    const queueDir = join(targetDir, ".rakazo", "queue");
    await fs.mkdir(queueDir, { recursive: true });

    // Create worktrees subdirectory
    const worktreesDir = join(queueDir, "worktrees");
    await fs.mkdir(worktreesDir, { recursive: true });
  }
}
