import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

function write(file: string, content: string, mode?: number) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (mode) chmodSync(file, mode);
}

function git(cwd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function commitAll(cwd: string) {
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "add", "infra");
  git(
    cwd,
    "-c",
    "user.name=Example",
    "-c",
    "user.email=example@example.test",
    "commit",
    "-qm",
    "init",
  );
}

function writeSnapshot(snapshot: string) {
  const payload = path.join(path.dirname(snapshot), "appdata-payload");
  write(path.join(payload, "home.txt"), "backed-up home");
  spawnSync("/usr/bin/tar", ["-czf", path.join(snapshot, "appdata.tgz"), "-C", payload, "."]);
  write(path.join(snapshot, "rakazo.dump"), "custom-format-dump-contents");
  const sums = ["rakazo.dump", "appdata.tgz"]
    .map((name) => {
      const hash = createHash("sha256")
        .update(readFileSync(path.join(snapshot, name)))
        .digest("hex");
      return `${hash}  ${name}`;
    })
    .join("\n");
  write(path.join(snapshot, "SHA256SUMS"), `${sums}\n`);
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rakazo-restore-prod-"));
  temporaryDirectories.push(root);
  const checkout = path.join(root, "checkout with spaces");
  const snapshots = path.join(root, "snapshots");
  const bin = path.join(root, "bin");

  write(
    path.join(checkout, "infra/compose/docker-compose.prod.yml"),
    "name: rakazo-prod\nservices: {}\n",
  );
  write(
    path.join(checkout, "infra/compose/restore-prod.sh"),
    readFileSync(path.join(repoRoot, "infra/compose/restore-prod.sh"), "utf8"),
  );
  commitAll(checkout);
  // .env is operator state, not tracked content, so editing it never looks dirty.
  write(
    path.join(checkout, ".env"),
    "ENCRYPTION_KEY=fake-key-32-characters\nBOBBOT_HOST=app.example.test\n",
  );

  const snapshot = path.join(snapshots, "rakazo-20261005T000000Z");
  mkdirSync(snapshot, { recursive: true });
  writeSnapshot(snapshot);

  // Record every privileged command instead of running it.
  write(
    path.join(bin, "docker"),
    `#!/bin/bash
printf '%s\\n' "docker $*" >> "$COMMAND_LOG"
case "$*" in
  *" up -d postgres"*)
    touch "$PG_UP"
    exit 0;;
  *" exec -T postgres pg_isready"*)
    if [[ -n "\${DB_PRESENT:-}" || -f "$PG_UP" ]]; then exit 0; fi
    exit 1;;
  *" exec -T postgres psql"*)
    if [[ "\${FAIL_RESTORE_DB:-}" == "1" ]]; then
      echo "ERROR: simulated restore failure" >&2
      exit 1
    fi
    cat > "$SQL_INPUT"
    exit 0;;
  *" --entrypoint sh api -c"*)
    if [[ "\${FAIL_RESTORE_FILES:-}" == "1" ]]; then
      cat > /dev/null
      echo "tar: simulated extraction failure" >&2
      exit 2
    fi
    cat > /dev/null
    exit 0;;
esac
exit 0
`,
    0o755,
  );
  write(
    path.join(bin, "pg_restore"),
    `#!/bin/bash
[[ -z "\${FAIL_VERIFY:-}" ]]
`,
    0o755,
  );

  const env = {
    PATH: [bin, "/usr/bin", "/bin"].join(path.delimiter),
    HOME: root,
    COMMAND_LOG: path.join(root, "commands.log"),
    BOBBOT_RESTORE_DIR: checkout,
    SQL_INPUT: path.join(root, "input.sql"),
    PG_UP: path.join(root, "pg-up"),
  };
  return {
    root,
    checkout,
    snapshots,
    snapshot,
    env,
    run(args: string[] = [], overrides: Record<string, string> = {}) {
      const result = spawnSync(
        "/bin/bash",
        [path.join(checkout, "infra/compose/restore-prod.sh"), ...args],
        {
          cwd: root,
          env: { ...env, ...overrides },
          encoding: "utf8",
          timeout: 20_000,
        },
      );
      expect(result.error).toBeUndefined();
      return result;
    },
    commands(): string[] {
      if (!existsSync(env.COMMAND_LOG)) return [];
      return readFileSync(env.COMMAND_LOG, "utf8").trim().split("\n").filter(Boolean);
    },
  };
}

describe("production snapshot restore", () => {
  it("verifies integrity and restores into a fresh stack", () => {
    const deploy = fixture();
    const result = deploy.run([deploy.snapshot]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Snapshot verified.");
    expect(result.stdout).toContain("Production restore complete");
    const commands = deploy.commands();
    expect(commands.some((line) => line.includes(" down"))).toBe(true);
    expect(commands.some((line) => line.includes(" psql"))).toBe(true);
    expect(commands.some((line) => line.includes(" --entrypoint sh api -c"))).toBe(true);
    expect(commands.some((line) => line.endsWith(" up -d api worker web"))).toBe(true);
    expect(readFileSync(deploy.env.SQL_INPUT, "utf8")).toContain("custom-format-dump-contents");
  });

  it("accepts the snapshot through BOBBOT_RESTORE_SNAPSHOT", () => {
    const deploy = fixture();
    const result = deploy.run([], { BOBBOT_RESTORE_SNAPSHOT: deploy.snapshot });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Production restore complete");
  });

  it("refuses a corrupt dump before touching the stack", () => {
    const deploy = fixture();
    write(path.join(deploy.snapshot, "rakazo.dump"), "not a dump");
    const result = deploy.run([deploy.snapshot], { FAIL_VERIFY: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("rakazo.dump is corrupt");
    expect(deploy.commands()).toEqual([]);
  });

  it("refuses a corrupt archive and a checksum mismatch before touching the stack", () => {
    const deploy = fixture();
    write(path.join(deploy.snapshot, "appdata.tgz"), "not an archive");
    const badArchive = deploy.run([deploy.snapshot]);
    expect(badArchive.status).toBe(1);
    expect(badArchive.stderr).toContain("appdata.tgz is corrupt");
    expect(deploy.commands()).toEqual([]);

    writeSnapshot(deploy.snapshot);
    write(path.join(deploy.snapshot, "SHA256SUMS"), "deadbeef  rakazo.dump\n");
    const badSums = deploy.run([deploy.snapshot]);
    expect(badSums.status).toBe(1);
    expect(badSums.stderr).toContain("SHA256SUMS does not match");
    expect(deploy.commands()).toEqual([]);
  });

  it("refuses to overwrite a reachable database without an explicit override", () => {
    const deploy = fixture();
    const result = deploy.run([deploy.snapshot], { DB_PRESENT: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BOBBOT_RESTORE_FORCE=1");
    expect(deploy.commands().filter((line) => !line.includes("pg_isready"))).toEqual([]);
  });

  it("fails closed when the database import errors", () => {
    const deploy = fixture();
    const result = deploy.run([deploy.snapshot], { FAIL_RESTORE_DB: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Database restore failed");
    expect(deploy.commands().some((line) => line.includes(" down"))).toBe(true);
    expect(deploy.commands().some((line) => line.endsWith(" up -d api worker web"))).toBe(false);
  });

  it("fails closed without starting the stack when the file extraction errors", () => {
    const deploy = fixture();
    const result = deploy.run([deploy.snapshot], { FAIL_RESTORE_FILES: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("File restore failed");
    expect(result.stdout).not.toContain("Production restore complete");
    expect(deploy.commands().some((line) => line.endsWith(" up -d api worker web"))).toBe(false);
  });

  it("refuses to start application services without the original encryption key", () => {
    const deploy = fixture();
    write(path.join(deploy.checkout, ".env"), "BOBBOT_HOST=app.example.test\n");

    const result = deploy.run([deploy.snapshot]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ENCRYPTION_KEY");
    expect(deploy.commands().some((line) => line.endsWith(" up -d api worker web"))).toBe(false);
  });

  it("refuses a dirty target checkout before running any command", () => {
    const deploy = fixture();
    write(path.join(deploy.checkout, "infra/compose/docker-compose.prod.yml"), "name: edited\n");

    const result = deploy.run([deploy.snapshot], { BOBBOT_RESTORE_DIR: deploy.checkout });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dirty");
    expect(deploy.commands()).toEqual([]);
  });

  it("rejects relative targets, missing checkouts, and missing snapshots", () => {
    const deploy = fixture();

    const relative = deploy.run([deploy.snapshot], { BOBBOT_RESTORE_DIR: "relative" });
    expect(relative.status).toBe(1);
    expect(relative.stderr).toContain("absolute path");
    expect(deploy.commands()).toEqual([]);

    const absent = deploy.run([deploy.snapshot], { BOBBOT_RESTORE_DIR: "/no/such/checkout" });
    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain("No .env");
    expect(deploy.commands()).toEqual([]);

    const missing = deploy.run(["/no/such/snapshot"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("No such snapshot directory");
    expect(deploy.commands()).toEqual([]);

    const unset = deploy.run([]);
    expect(unset.status).toBe(1);
    expect(unset.stderr).toContain("Usage:");
    expect(deploy.commands()).toEqual([]);
  });
});
