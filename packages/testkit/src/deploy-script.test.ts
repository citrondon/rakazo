import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
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

function write(file: string, content: string, mode?: number) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (mode) chmodSync(file, mode);
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd: string, message: string) {
  write(path.join(cwd, "revision.txt"), `${message}\n`);
  git(cwd, "add", "revision.txt");
  git(
    cwd,
    "-c",
    "user.name=Example",
    "-c",
    "user.email=example@example.test",
    "commit",
    "-qm",
    message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rakazo-deploy-"));
  temporaryDirectories.push(root);
  const upstream = path.join(root, "upstream");
  const checkout = path.join(root, "checkout with spaces");
  const bin = path.join(root, "bin");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "main");
  const first = commit(upstream, "first");
  git(root, "clone", "-q", upstream, checkout);
  write(path.join(checkout, ".env"), "RAKAZO_HOST=app.example.test\n");
  // The fixture starts with a stack already deployed at `first`.
  write(path.join(root, "running-revision"), `${first}\n`);
  // The script validates that every configured Compose file exists in the checkout.
  write(path.join(checkout, "infra/compose/docker-compose.prod.yml"), "name: rakazo-prod\n");
  const log = path.join(root, "commands.log");
  // Record every privileged or network command instead of running it.
  write(path.join(bin, "sudo"), '#!/bin/bash\nexec "$@"\n', 0o755);
  write(
    path.join(bin, "timeout"),
    '#!/bin/bash\nwhile [[ "$1" == --* ]]; do shift; done\nshift\nexec "$@"\n',
    0o755,
  );
  write(
    path.join(bin, "docker"),
    `#!/bin/bash
printf 'docker %s @ %s\\n' "$*" "$(git rev-parse --short HEAD)" >> "$COMMAND_LOG"
if [[ "$*" == *" build" && -n "\${FAIL_BUILD:-}" ]]; then exit 1; fi
if [[ "$*" == *" exec -T postgres pg_isready"* ]]; then
  if [[ -n "\${DB_PRESENT:-}" || -f "$PG_UP" ]]; then exit 0; fi
  exit 1
fi
if [[ "$*" == *" sh -c "* ]]; then
  if [[ -n "\${FAIL_DUMP:-}" ]]; then exit 2; fi
  printf 'fake custom-format dump\\n'
  exit 0
fi
if [[ "$*" == *" pg_restore"* ]]; then
  cat > /dev/null
  [[ -z "\${FAIL_VERIFY:-}" ]]
  exit $?
fi
if [[ "$*" == *"internal/health"* ]]; then
  if [[ -n "\${ROLLBACK_STALE:-}" ]]; then exit 1; fi
  target="\${!#}"
  [[ "$target" == "$(cat "$RUNNING" 2>/dev/null)" ]] && exit 0
  exit 1
fi
if [[ "$*" == *" logs "* && "$*" == *"worker"* ]]; then
  if [[ -n "\${FAIL_WORKER:-}" ]]; then exit 0; fi
  printf '{"message":"worker ready"}\\n'
  exit 0
fi
if [[ "$*" == *" up -d"* ]]; then
  touch "$PG_UP"
  if [[ -z "\${NO_RECREATE:-}" ]]; then git rev-parse HEAD > "$RUNNING"; fi
  exit 0
fi
exit 0
`,
    0o755,
  );
  write(path.join(bin, "pg_restore"), `#!/bin/bash\nexit 0\n`, 0o755);
  write(
    path.join(bin, "curl"),
    `#!/bin/bash\necho "curl \${*: -1}" >> "$COMMAND_LOG"\n[[ -z "\${FAIL_HEALTH:-}" ]]\n`,
    0o755,
  );
  write(path.join(bin, "flock"), `#!/bin/bash\n[[ -z "\${LOCK_HELD:-}" ]]\n`, 0o755);
  const env = {
    PATH: [bin, "/usr/bin", "/bin"].join(path.delimiter),
    HOME: root,
    COMMAND_LOG: log,
    RAKAZO_DEPLOY_DIR: checkout,
    RAKAZO_DEPLOY_HEALTH_INTERVAL: "0",
    PG_UP: path.join(root, "pg-up"),
    RUNNING: path.join(root, "running-revision"),
  };
  return {
    upstream,
    checkout,
    first,
    run(overrides: Record<string, string> = {}) {
      const result = spawnSync("/bin/bash", [path.join(repoRoot, "infra/compose/deploy-main.sh")], {
        cwd: root,
        env: { ...env, ...overrides },
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(result.error).toBeUndefined();
      return result;
    },
    commands(): string[] {
      try {
        return readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
    docker(): string[] {
      return this.commands()
        .filter((line) => line.startsWith("docker "))
        .map((line) => line.split(" @ ")[0]!.replace(/^docker /, ""));
    },
    head: () => git(checkout, "rev-parse", "HEAD"),
    deployed: () => readFileSync(path.join(checkout, ".last-deployed-revision"), "utf8").trim(),
  };
}

const BASE_ARGS = "compose --env-file .env -f infra/compose/docker-compose.prod.yml";

describe("production deploy script", () => {
  it("refuses a missing or non-commit target revision", () => {
    const deploy = fixture();
    const missing = deploy.run();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("tested full commit SHA");

    const absent = deploy.run({ RAKAZO_DEPLOY_REVISION: "0".repeat(40) });
    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain("not present");
    expect(deploy.docker()).toEqual([]);
  });

  it("refuses a revision that is not on origin/main", () => {
    const deploy = fixture();
    git(deploy.upstream, "checkout", "-q", "-b", "side");
    const side = commit(deploy.upstream, "side");
    git(deploy.upstream, "checkout", "-q", "main");
    git(deploy.checkout, "fetch", "-q", "origin", side);

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: side });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not on origin/main");
    expect(deploy.docker()).toEqual([]);
  });

  it("fails instead of reporting success while another deploy holds the lock", () => {
    const deploy = fixture();
    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: deploy.first, LOCK_HELD: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("holds the lock");
    expect(deploy.docker()).toEqual([]);
  });

  it("only verifies readiness when production is already at the target", () => {
    const deploy = fixture();
    write(path.join(deploy.checkout, ".last-deployed-revision"), `${deploy.first}\n`);

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: deploy.first });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already at");
    expect(deploy.docker().some((line) => line.includes("internal/health"))).toBe(true);
    expect(deploy.docker().some((line) => line.includes(" logs ") && line.includes("worker"))).toBe(
      true,
    );
    expect(deploy.docker().some((line) => line.endsWith(" build"))).toBe(false);
  });

  it("deploys when the checkout matches the target but that revision was never recorded", () => {
    const deploy = fixture();
    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: deploy.first });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("already at");
    expect(deploy.head()).toBe(deploy.first);
    expect(deploy.deployed()).toBe(deploy.first);
  });

  it("deploys the tested revision even when main moved on", () => {
    const deploy = fixture();
    commit(deploy.upstream, "next");

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: deploy.first });
    expect(result.status).toBe(0);
    expect(deploy.head()).toBe(deploy.first);
    expect(deploy.deployed()).toBe(deploy.first);
    const dockerLines = deploy.commands().filter((line) => line.startsWith("docker "));
    expect(dockerLines.every((line) => line.endsWith(`@ ${deploy.first.slice(0, 7)}`))).toBe(true);
  });

  it("builds, waits for health, verifies revision and worker, then records the target", () => {
    const deploy = fixture();
    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: deploy.first });
    expect(result.status).toBe(0);

    const core = deploy.docker().filter((line) => / (config --quiet|build|up -d )/.test(line));
    expect(core).toEqual([
      `${BASE_ARGS} config --quiet`,
      `${BASE_ARGS} build`,
      `${BASE_ARGS} up -d --wait --wait-timeout 300 --remove-orphans`,
    ]);
    expect(deploy.docker().some((line) => line.includes("internal/health"))).toBe(true);
    expect(deploy.docker().some((line) => line.includes(" logs ") && line.includes("worker"))).toBe(
      true,
    );
  });

  it("rolls back to the previous revision when the build fails", () => {
    const deploy = fixture();
    commit(deploy.upstream, "broken");
    const next = git(deploy.upstream, "rev-parse", "HEAD");

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: next, FAIL_BUILD: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Rolled back to");
    expect(result.stderr).toContain("and it is serving");
    expect(deploy.head()).toBe(deploy.first);
    // Der Rollback baut die alte Revision und startet sie neu.
    const rollbackUp = deploy
      .docker()
      .findIndex((line) =>
        line.includes(" up -d --build --wait --wait-timeout 300 --remove-orphans"),
      );
    expect(rollbackUp).toBeGreaterThan(0);
  });

  it("rolls back when the API keeps serving the old revision", () => {
    const deploy = fixture();
    commit(deploy.upstream, "stale");
    const next = git(deploy.upstream, "rev-parse", "HEAD");

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: next, NO_RECREATE: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Rolled back to");
    expect(result.stderr).toContain("and it is serving");
    expect(deploy.head()).toBe(deploy.first);
  });

  it("rolls back when the worker never reports ready", () => {
    const deploy = fixture();
    commit(deploy.upstream, "workerless");
    const next = git(deploy.upstream, "rev-parse", "HEAD");

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: next, FAIL_WORKER: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("never became ready");
    expect(deploy.head()).toBe(deploy.first);
  });

  it("rolls back when production never becomes healthy", () => {
    const deploy = fixture();
    commit(deploy.upstream, "unhealthy");
    const next = git(deploy.upstream, "rev-parse", "HEAD");

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: next, FAIL_HEALTH: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("never became ready");
    expect(deploy.head()).toBe(deploy.first);
  });

  it("snapshots the database before a real update and prunes old snapshots", () => {
    const deploy = fixture();
    const next = commit(deploy.upstream, "next");

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: next, DB_PRESENT: "1" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Pre-deploy database snapshot verified");

    const pre = path.join(deploy.checkout, ".pre-deploy");
    const snapshots = readdirSync(pre);
    expect(snapshots).toHaveLength(1);
    const snapshot = path.join(pre, snapshots[0]!);
    expect(statSync(snapshot).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(snapshot, "rakazo.dump")).mode & 0o777).toBe(0o600);
    expect(readFileSync(path.join(snapshot, "rakazo.dump"), "utf8")).toContain(
      "fake custom-format dump",
    );
    expect(statSync(path.join(snapshot, "SHA256SUMS")).mode & 0o777).toBe(0o600);

    // The snapshot is taken before anything touches the checkout or containers.
    const commands = deploy.docker();
    const dump = commands.findIndex((line) => line.includes("pg_dump"));
    const build = commands.findIndex((line) => line.endsWith(" build"));
    expect(dump).toBeGreaterThanOrEqual(0);
    expect(dump).toBeLessThan(build);
  });

  it("skips the snapshot on a first deploy when postgres is not running", () => {
    const deploy = fixture();

    const result = deploy.run({ RAKAZO_DEPLOY_REVISION: deploy.first });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("skipping the pre-deploy snapshot");
    expect(deploy.commands().some((line) => line.includes("pg_dump"))).toBe(false);
    expect(existsSync(path.join(deploy.checkout, ".pre-deploy"))).toBe(false);
  });

  it.each([{ FAIL_DUMP: "1" }, { FAIL_VERIFY: "1" }])(
    "refuses the whole update when the pre-deploy snapshot is unusable: %j",
    (failure) => {
      const deploy = fixture();
      const next = commit(deploy.upstream, "next");

      const result = deploy.run({ RAKAZO_DEPLOY_REVISION: next, DB_PRESENT: "1", ...failure });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("refusing to update");
      expect(deploy.head()).not.toBe(next);
      expect(existsSync(path.join(deploy.checkout, ".pre-deploy"))).toBe(false);
      expect(deploy.commands().some((line) => line.endsWith(" build"))).toBe(false);
    },
  );

  it("points at the pre-deploy snapshot when the rollback never becomes ready", () => {
    const deploy = fixture();
    const next = commit(deploy.upstream, "migrating");

    const result = deploy.run({
      RAKAZO_DEPLOY_REVISION: next,
      DB_PRESENT: "1",
      ROLLBACK_STALE: "1",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("may have been migrated");
    expect(result.stderr).toContain(".pre-deploy/");
    expect(result.stderr).toContain("restore-prod.sh");
    expect(deploy.head()).toBe(deploy.first);
  });

  it("rejects a Compose file outside the checkout before touching Docker", () => {
    const deploy = fixture();
    const result = deploy.run({
      RAKAZO_DEPLOY_REVISION: deploy.first,
      RAKAZO_DEPLOY_COMPOSE_FILES: "../evil.yml",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid Compose file");
    expect(deploy.docker()).toEqual([]);
  });

  it("deploys a Docker overlay stack with the same file list it runs with", () => {
    const deploy = fixture();
    write(
      path.join(deploy.checkout, "infra/compose/docker-compose.prod.docker.yml"),
      "services: {}\n",
    );

    const result = deploy.run({
      RAKAZO_DEPLOY_REVISION: deploy.first,
      RAKAZO_DEPLOY_COMPOSE_FILES:
        "infra/compose/docker-compose.prod.yml infra/compose/docker-compose.prod.docker.yml",
    });
    expect(result.status).toBe(0);
    const build = deploy.docker().find((line) => line.endsWith(" build"));
    expect(build).toBe(
      "compose --env-file .env -f infra/compose/docker-compose.prod.yml -f infra/compose/docker-compose.prod.docker.yml build",
    );
  });
});
