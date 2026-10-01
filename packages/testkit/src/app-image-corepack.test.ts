import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Both app images serve api, worker and web, so both owe the runtime user the same cache. */
const APP_DOCKERFILES = ["infra/compose/Dockerfile", "infra/compose/Dockerfile.topology"] as const;
/** Compose files that start api, worker and web from the app image. */
const IMAGE_COMPOSE_FILES = [
  "infra/compose/docker-compose.images.yml",
  "infra/compose/docker-compose.prod.yml",
] as const;
/** Services that run as the image's `node` user (HOME=/home/node) and never as root. */
const APP_SERVICES = ["api", "worker", "web"] as const;

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string) => readFileSync(path.resolve(repoRoot, relative), "utf8");

/** Returns the indented block of one top-level compose service. */
function serviceBlock(compose: string, name: string): string {
  const lines = compose.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`service ${name} missing`);
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("    ")) break;
    block.push(line);
  }
  return block.join("\n");
}

describe("app image package manager", () => {
  it("prepares the exact packageManager pin declared by the repo", () => {
    const pinned = JSON.parse(read("package.json")).packageManager as string;
    expect(pinned).toBe("pnpm@9.15.0");
    for (const dockerfile of APP_DOCKERFILES) {
      expect(read(dockerfile)).toContain(`corepack prepare ${pinned} --activate`);
    }
  });

  it("points the corepack cache at a path set before corepack is enabled", () => {
    for (const dockerfile of APP_DOCKERFILES) {
      const content = read(dockerfile);
      expect(content).toContain("ENV COREPACK_HOME=/opt/corepack");
      expect(content.indexOf("ENV COREPACK_HOME=/opt/corepack")).toBeLessThan(
        content.indexOf("corepack enable"),
      );
    }
  });

  it("makes the baked cache readable by every runtime user", () => {
    for (const dockerfile of APP_DOCKERFILES) {
      expect(read(dockerfile)).toContain("chmod -R a+rX /opt/corepack");
    }
  });

  it("refuses corepack networking only after the build installed dependencies", () => {
    for (const dockerfile of APP_DOCKERFILES) {
      const content = read(dockerfile);
      expect(content).toContain("ENV COREPACK_ENABLE_NETWORK=0");
      expect(content.indexOf("ENV COREPACK_ENABLE_NETWORK=0")).toBeGreaterThan(
        content.indexOf("RUN pnpm install --frozen-lockfile"),
      );
    }
  });

  it("keeps the api entrypoint unchanged", () => {
    for (const dockerfile of APP_DOCKERFILES) {
      expect(
        read(dockerfile).trimEnd().endsWith('CMD ["pnpm", "--filter", "@rakazo/api", "start"]'),
      ).toBe(true);
    }
  });
});

describe("app image runtime identity", () => {
  for (const composePath of IMAGE_COMPOSE_FILES) {
    it(`starts api, worker and web without a user override in ${composePath}`, () => {
      const compose = read(composePath);
      for (const name of APP_SERVICES) {
        expect(serviceBlock(compose, name)).not.toMatch(/^ {4}user:/m);
      }
    });
  }
});

describe("app image offline proof", () => {
  it("runs the built app image as node without network in the publish workflow", () => {
    const workflow = read(".github/workflows/publish-server-image.yml");
    expect(workflow).toContain("docker run --rm --network none --user node");
    expect(workflow).toContain("pnpm --version");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the literal workflow expression
    expect(workflow).toContain("load: ${{ matrix.name == 'app' }}");
    expect(workflow).toContain("if: matrix.name == 'app'");
  });

  it("documents that starting the stack needs no package-manager download", () => {
    expect(read("docs/self-host-restricted-network.md")).toContain("/opt/corepack");
  });
});
