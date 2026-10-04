import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A service that another service waits for with `condition: service_healthy`
 * must declare a healthcheck. Compose refuses to start the dependent service
 * otherwise ("dependency failed to start: container ... has no healthcheck
 * configured"), which is how the source-build file silently lost its worker.
 */
const COMPOSE_FILES = [
  "infra/compose/docker-compose.images.yml",
  "infra/compose/docker-compose.build.yml",
] as const;

/** Dependencies that gate on a healthcheck in both files, so neither stack drifts. */
const GATED_DEPENDENCIES = [
  { service: "worker", target: "api" },
  { service: "api", target: "postgres" },
  { service: "api", target: "supervisor" },
] as const;

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

/** Every service name in the file's `services:` mapping. */
function serviceNames(compose: string): string[] {
  const lines = compose.split("\n");
  const start = lines.indexOf("services:");
  if (start === -1) throw new Error("services: missing");
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("  ")) break;
    const match = /^ {2}([a-z0-9-]+):$/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

/** One service's `depends_on` entries and the condition each one declares. */
function dependencies(block: string): Array<{ name: string; condition?: string }> {
  const lines = block.split("\n");
  const at = lines.findIndex((line) => line === "    depends_on:");
  if (at === -1) return [];
  const entries: Array<{ name: string; condition?: string }> = [];
  let current: { name: string; condition?: string } | undefined;
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !line.startsWith("      ")) break;
    const short = /^ {6}- ([a-z0-9-]+)$/.exec(line);
    if (short) {
      current = { name: short[1] };
      entries.push(current);
      continue;
    }
    const long = /^ {6}([a-z0-9-]+):$/.exec(line);
    if (long) {
      current = { name: long[1] };
      entries.push(current);
      continue;
    }
    const condition = /^ {8}condition: (service_\w+)$/.exec(line);
    if (condition && current) current.condition = condition[1];
  }
  return entries;
}

describe("compose healthchecks", () => {
  it("passes the egress policy to the production Docker supervisor", () => {
    const supervisor = serviceBlock(
      read("infra/compose/docker-compose.prod.docker.yml"),
      "supervisor",
    );
    expect(supervisor).toContain("SANDBOX_COMPUTER_EGRESS: ${SANDBOX_COMPUTER_EGRESS:-open}");
    expect(supervisor).not.toMatch(/^ {4}env_file:/m);
  });
  for (const composePath of COMPOSE_FILES) {
    it(`declares a healthcheck for every healthcheck-gated dependency in ${composePath}`, () => {
      const compose = read(composePath);
      const missing: string[] = [];
      for (const service of serviceNames(compose)) {
        for (const dependency of dependencies(serviceBlock(compose, service))) {
          if (dependency.condition !== "service_healthy") continue;
          if (!/^ {4}healthcheck:$/m.test(serviceBlock(compose, dependency.name))) {
            missing.push(`${service} waits for ${dependency.name}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it(`keeps the gating dependencies of the stack in ${composePath}`, () => {
      const compose = read(composePath);
      for (const { service, target } of GATED_DEPENDENCIES) {
        const dependency = dependencies(serviceBlock(compose, service)).find(
          (entry) => entry.name === target,
        );
        expect(dependency?.condition, `${service} must gate on ${target}`).toBe("service_healthy");
      }
    });
  }
});
