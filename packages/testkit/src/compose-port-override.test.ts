import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Both documented stacks publish api/web on loopback, so both owe the operator the same overrides. */
const COMPOSE_FILES = [
  "infra/compose/docker-compose.yml",
  "infra/compose/docker-compose.images.yml",
] as const;
/** The templates a source checkout and the installer hand out; the overrides stay commented there. */
const ENV_TEMPLATES = ["infra/compose/.env.images.example", ".env.example"] as const;
const SOURCE_COMPOSE = "infra/compose/docker-compose.yml";
const PORT_HEADING = "### Port conflicts (3100 / 5173)";
const RESTRICTED_NETWORK_HEADING = "### Restricted networks / mirror downloads";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string) => readFileSync(path.resolve(repoRoot, relative), "utf8");

describe("compose host port overrides", () => {
  it("publishes both host ports through the same two variables in both compose files", () => {
    for (const composePath of COMPOSE_FILES) {
      const compose = read(composePath);
      // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the literal Compose expression
      expect(compose).toContain('"127.0.0.1:${RAKAZO_API_PORT:-3100}:3100"');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the literal Compose expression
      expect(compose).toContain('"127.0.0.1:${RAKAZO_WEB_PORT:-5173}:5173"');
    }
  });

  it("keeps no hard-coded loopback binding in the source-checkout compose file", () => {
    expect(read(SOURCE_COMPOSE)).not.toMatch(/127\.0\.0\.1:(3100:3100|5173:5173)/);
  });

  it("documents both variables commented out, so an unset value leaves the defaults", () => {
    for (const template of ENV_TEMPLATES) {
      const content = read(template);
      expect(content).toContain("RAKAZO_API_PORT");
      expect(content).toContain("RAKAZO_WEB_PORT");
      expect(content).not.toMatch(/^RAKAZO_(API|WEB)_PORT=/m);
    }
  });

  it("documents the conflict above the restricted-network section", () => {
    const docs = read("docs/self-host.md");
    expect(docs).toContain(PORT_HEADING);
    expect(docs.indexOf(PORT_HEADING)).toBeLessThan(docs.indexOf(RESTRICTED_NETWORK_HEADING));
  });

  it("names the port owner, the raw Docker errors, and the exact env fix", () => {
    const docs = read("docs/self-host.md");
    expect(docs).toContain("lsof -nP -iTCP:3100 -sTCP:LISTEN");
    expect(docs).toContain("bind: address already in use");
    expect(docs).toContain("port is already allocated");
    expect(docs).toContain("RAKAZO_API_PORT=0");
    expect(docs).toContain("RAKAZO_WEB_PORT=5174");
  });

  it("quotes the desktop notice the app actually prints", () => {
    expect(read("apps/desktop/src/local-stack.ts")).toContain("already in use");
  });
});
