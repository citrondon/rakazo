#!/usr/bin/env node
// Mirror a bot's shared workspace between its sandbox container and the host folder you edit in.
//
// This used to be a PowerShell script with a hard-coded Windows host path, so the workflow was
// unavailable everywhere the project is developed from a non-Windows machine.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ACTIONS = new Set(["pull", "push", "watch"]);
const SAFE_REMOTE_PATH = /^\/[A-Za-z0-9._/-]*$/;

function parseArgs(argv) {
  const action = argv[0];
  if (!ACTIONS.has(action)) {
    console.error(
      `usage: sync-workspace.mjs <${[...ACTIONS].join("|")}> [--dir <path>] [--interval <ms>]`,
    );
    process.exit(2);
  }
  const flags = new Map();
  for (let i = 1; i < argv.length; i += 2) flags.set(argv[i], argv[i + 1]);
  const unknown = [...flags.keys()].filter((key) => !key.startsWith("--"));
  if (unknown.length > 0) {
    console.error(`unknown option ${unknown.join(", ")}`);
    process.exit(2);
  }
  return {
    action,
    localDir: path.resolve(flags.get("--dir") ?? process.env.BOBBOT_WORKSPACE_DIR ?? "workspace"),
    intervalMs: Number(flags.get("--interval") ?? 1000),
  };
}

function docker(args, print = false) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (print && result.stdout) process.stdout.write(result.stdout);
  return { out: (result.stdout ?? "").trim(), ok: result.status === 0 };
}

function execSh(container, command) {
  return docker(["exec", container, "sh", "-c", command]).out;
}

/** Containers this checkout can see, as { name, image }. */
function runningContainers() {
  const { out } = docker(["ps", "--format", "{{.Names}}\t{{.Image}}"]);
  return out
    ? out.split("\n").map((line) => {
        const [name, image] = line.split("\t");
        return { name, image };
      })
    : [];
}

function findTarget() {
  const containers = runningContainers();
  const api = containers.find(({ name }) => name.endsWith("-api-1"));
  if (api) {
    // A compose checkout bind-mounts ./data at /data, so any team home exposes the shared workspace.
    const shared = execSh(api.name, "ls -d /data/homes/*/shared 2>/dev/null | head -n 1");
    if (SAFE_REMOTE_PATH.test(shared)) return { container: api.name, remoteDir: shared };
  }
  const computer =
    containers.find(({ image }) => image.includes("rakazo/computer")) ??
    containers.find(({ name }) => name.startsWith("rakazo-bot"));
  if (computer) return { container: computer.name, remoteDir: "/home/rakazo/shared" };
  return null;
}

function supervisor() {
  return runningContainers().find(({ name }) => name.includes("supervisor"))?.name;
}

function localFingerprint(dir) {
  if (!existsSync(dir)) return "";
  const stamp = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const stats = statSync(path.join(entry.parentPath ?? entry.path, entry.name));
    stamp.push(`${entry.name}|${stats.size}|${Math.round(stats.mtimeMs)}`);
  }
  return stamp.sort().join(";");
}

function remoteFingerprint({ container, remoteDir }) {
  // Sorted because find emits in directory order, which changes as bots write.
  return execSh(container, `find '${remoteDir}' -type f -printf '%f|%s|%T@\\n' 2>/dev/null | sort`);
}

function pull(target, localDir) {
  console.log(`[pull] ${target.container}:${target.remoteDir} -> ${localDir}`);
  docker(["cp", `${target.container}:${target.remoteDir}/.`, localDir], true);
}

function push(target, localDir) {
  console.log(`[push] ${localDir} -> ${target.container}:${target.remoteDir}`);
  docker(["cp", `${localDir}/.`, `${target.container}:${target.remoteDir}/`], true);
  const supervisorName = supervisor();
  if (supervisorName) {
    // Bots write as uid 1000; files copied in from the host arrive as whoever ran this.
    // Chown only the synced folder, not all of /data/homes, which may hold other teams.
    execSh(supervisorName, `chown -R 1000:1000 '${target.remoteDir}' 2>/dev/null || true`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function watch(target, { localDir, intervalMs }) {
  let lastLocal = localFingerprint(localDir);
  let lastRemote = "";
  if (target) {
    pull(target, localDir);
    lastRemote = remoteFingerprint(target);
  } else {
    console.log("[watch] waiting for a rakazo container to start");
  }

  for (;;) {
    await sleep(intervalMs);
    const current = findTarget();
    if (!current) continue;

    const local = localFingerprint(localDir);
    if (local !== lastLocal) {
      push(current, localDir);
      lastLocal = local;
      lastRemote = remoteFingerprint(current);
      continue;
    }

    const remote = remoteFingerprint(current);
    if (remote && remote !== lastRemote) {
      pull(current, localDir);
      lastLocal = localFingerprint(localDir);
      lastRemote = remote;
    }
  }
}

const options = parseArgs(process.argv.slice(2));
mkdirSync(options.localDir, { recursive: true });
if (options.action === "watch") {
  await watch(findTarget(), options);
} else {
  const target = findTarget();
  if (!target) {
    console.warn(`[sync] no running rakazo api or computer container found for ${options.action}`);
  } else if (options.action === "pull") {
    pull(target, options.localDir);
  } else {
    push(target, options.localDir);
  }
}
