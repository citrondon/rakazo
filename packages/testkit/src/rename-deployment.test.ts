import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const COMPOSE = [
  `name: \${COMPOSE_PROJECT_NAME:-rakazo-prod}`,
  "services:",
  "  postgres:",
  "    image: postgres:16",
  "volumes:",
  "  pgdata:",
  `    name: \${BOBBOT_VOLUME_PREFIX:-\${RAKAZO_VOLUME_PREFIX:-rakazo-prod}}_pgdata`,
  "",
].join("\n");

const RENDERED = [
  "name: rakazo-prod",
  "services:",
  "  postgres:",
  "    image: postgres:16",
  "volumes:",
  "  pgdata:",
  "    name: rakazo-prod_pgdata",
  "",
].join("\n");

/** A deployment fixture whose `docker` is a stub, so the script stays offline. */
function fixture(options: { running?: boolean } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "rakazo-rename-"));
  temporaryDirectories.push(root);
  const bin = path.join(root, "bin");
  mkdirSync(path.join(root, "infra/compose"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(path.join(root, "infra/compose/docker-compose.prod.yml"), COMPOSE);
  writeFileSync(path.join(root, ".env"), "BOBBOT_HOST=example.test\nPOSTGRES_PASSWORD=secret\n");
  writeFileSync(path.join(bin, "docker"), runningStub(options.running === true), {
    mode: 0o755,
  });
  chmodSync(path.join(bin, "docker"), 0o755);
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync("bash", [path.join(repoRoot, "infra/compose/rename-deployment.sh"), ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        BOBBOT_DEPLOY_DIR: root,
        ...env,
      },
    });
  return { root, run, envFile: path.join(root, ".env") };
}

function runningStub(running: boolean) {
  return `#!/bin/sh
# Stub docker: answers the two read-only calls the rename script makes.
case "$*" in
  *" config"*) cat <<'YAML'
${RENDERED}YAML
    ;;
  *"ps -q --filter volume="*)
    ${running ? 'echo "container-that-holds-the-volume"' : ":"}
    ;;
  *)
    echo "stub docker got '$*'" >&2
    exit 1
    ;;
esac
`;
}

describe("renaming a deployment", () => {
  it("is a script a shell can parse", () => {
    const result = spawnSync(
      "bash",
      ["-n", path.join(repoRoot, "infra/compose/rename-deployment.sh")],
      {
        encoding: "utf8",
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("keeps the volume names the deployment uses today", () => {
    const files = [
      "infra/compose/docker-compose.yml",
      "infra/compose/docker-compose.topology.yml",
      "infra/compose/docker-compose.build.yml",
      "infra/compose/docker-compose.images.yml",
      "infra/compose/docker-compose.prod.yml",
    ];
    for (const file of files) {
      const content = readFileSync(path.join(repoRoot, file), "utf8");
      const names = content.match(/^ {4}name: \$\{BOBBOT_VOLUME_PREFIX/gm) ?? [];
      const volumes = content.match(/^ {2}[a-zA-Z0-9_.-]+:\n {4}name:/gm) ?? [];
      expect(names.length, `${file} pins every volume`).toBe(volumes.length);
      expect(names.length, `${file} declares volumes`).toBeGreaterThan(0);
    }
  });

  it("prints the plan and leaves the environment file alone without --apply", () => {
    const f = fixture();
    const before = readFileSync(f.envFile, "utf8");
    const result = f.run([]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("rakazo-prod_pgdata");
    expect(result.stdout).toContain("Dry run");
    expect(result.stdout).toContain("Rollback");
    expect(readFileSync(f.envFile, "utf8")).toBe(before);
  });

  it("refuses to copy the files of a volume a container is still using", () => {
    const f = fixture({ running: true });
    const result = f.run(["--apply"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Stop the stack first");
    expect(readFileSync(f.envFile, "utf8")).not.toContain("BOBBOT_VOLUME_PREFIX");
  });

  it("installs the new systemd names and keeps the old ones as symlinks", () => {
    const content = readFileSync(path.join(repoRoot, "infra/compose/rename-deployment.sh"), "utf8");
    expect(content).toContain(
      "ln -sfn /etc/systemd/system/bobbot-backup.service /etc/systemd/system/rakazo-backup.service",
    );
    expect(existsSync(path.join(repoRoot, "infra/systemd/bobbot-backup.timer"))).toBe(true);
    const service = readFileSync(
      path.join(repoRoot, "infra/systemd/bobbot-backup.service"),
      "utf8",
    );
    expect(service).toContain("ExecStart=/usr/local/sbin/bobbot-backup");
  });
});
