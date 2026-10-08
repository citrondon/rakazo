import { randomUUID } from "node:crypto";
import { closeSync, constants, openSync } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  NotificationMessage,
  NotificationProvider,
} from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import koffi from "koffi";
import { combineSignals } from "./connector-safety.js";
import { readBodyCapped, withAbort } from "./web-ssrf.js";

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const EXPO_PUSH_TIMEOUT_MS = 15_000;
export const MAX_EXPO_PUSH_RESPONSE_BYTES = 64 * 1024;

/** A device/installation id becomes a file name, so it must not escape its directory. */
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function assertDeviceId(deviceId: string) {
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw new Error("Invalid push device id.");
}

/** Data a notification tap uses to open the bot or group thread in its space.
 * `deliveryId` distinguishes this send from another push for the same thread:
 * the Expo request identifier stays the thread id. */
export function expoPushData(message: NotificationMessage, spaceId: string, deliveryId: string) {
  return {
    kind: message.kind,
    botId: message.botId,
    threadId: message.threadId,
    deliveryId,
    ...(spaceId ? { spaceId } : {}),
    ...(message.groupId ? { groupId: message.groupId } : {}),
  };
}

/** Legacy single-token path for accounts registered before per-installation tokens. */
export function pushTokenPath(dataDir: string, userId: string) {
  return path.join(dataDir, "push-tokens", `${userId}.txt`);
}

function pushDeviceDir(dataDir: string, userId: string) {
  return path.join(dataDir, "push-tokens", userId);
}

export function pushDeviceTokenPath(dataDir: string, userId: string, deviceId: string) {
  assertDeviceId(deviceId);
  return path.join(pushDeviceDir(dataDir, userId), `${deviceId}.txt`);
}

type PushRecord = { token: string; sessionId?: string };

const PUSH_TOKEN_LOCK_WAIT_MS = 15_000;

/** Registration found that its session was already gone. */
export class PushSessionEndedError extends Error {
  constructor() {
    super("Push session ended");
    this.name = "PushSessionEndedError";
  }
}

/** Expiry of the session that registered a token, or null when that session is gone. */
export type PushSessionExpiresAt = (sessionId: string) => Promise<Date | null>;

type SavePushTokenOptions = {
  /** Checked under the token lock, before the token is published. */
  sessionActive?: () => Promise<boolean>;
  /** Runs under the lock after other owners are read and before they are removed. */
  beforeRemoveOthers?: () => Promise<void>;
};

type EndSessionPushTokenOptions = {
  /** Runs after this account's record is read and before the conditional update. */
  beforeCommit?: () => Promise<void>;
};

/** The file holds the token, then the id of the session that registered it. */
async function readTokenFile(file: string): Promise<PushRecord | undefined> {
  try {
    const handle = await open(file, constants.O_RDONLY | O_NOFOLLOW);
    try {
      const [token, sessionId] = (await handle.readFile("utf8")).trim().split("\n");
      return token ? { token, sessionId: sessionId || undefined } : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function writeTokenFile(file: string, record: PushRecord): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const staging = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await open(
    staging,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    const body = record.sessionId ? `${record.token}\n${record.sessionId}` : record.token;
    await handle.writeFile(body, "utf8");
  } finally {
    await handle.close();
  }
  // Renamed into place, so a concurrent read sees the old or the new token, never an empty file.
  await rename(staging, file).catch(async (error: unknown) => {
    await unlink(staging).catch(() => undefined);
    throw error;
  });
}

async function deleteTokenFile(file: string): Promise<void> {
  await unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function samePushRecord(left: PushRecord | undefined, right: PushRecord | undefined): boolean {
  if (!left || !right) return !left && !right;
  return left.token === right.token && left.sessionId === right.sessionId;
}

/** Writes `next` only when the file still equals `expected`. Callers hold the token lock. */
async function compareAndSwapPushRecord(
  file: string,
  expected: PushRecord | undefined,
  next: PushRecord | undefined,
): Promise<boolean> {
  const current = await readTokenFile(file);
  if (!samePushRecord(current, expected)) return false;
  if (!next) {
    await deleteTokenFile(file);
    return true;
  }
  await writeTokenFile(file, next);
  return true;
}

/**
 * API and worker are separate processes, sometimes separate containers, sharing
 * this directory. The lock is the kernel lock on `.lock`: the same file on a
 * shared volume, released when the holder exits, including a crash. An empty
 * lock file is not itself the lock.
 */
async function withPushTokenLock<T>(dataDir: string, body: () => Promise<T>): Promise<T> {
  const release = await acquirePushTokenLock(dataDir);
  try {
    return await body();
  } finally {
    await release();
  }
}

async function acquirePushTokenLock(dataDir: string): Promise<() => Promise<void>> {
  const dir = path.join(dataDir, "push-tokens");
  await mkdir(dir, { recursive: true });
  const lockFile = path.join(dir, ".lock");
  const fd = openSync(lockFile, constants.O_CREAT | constants.O_RDWR | O_NOFOLLOW, 0o600);
  try {
    await waitForExclusiveLock(fd);
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return async () => {
    try {
      unlockExclusive(fd);
    } finally {
      closeSync(fd);
    }
  };
}

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
const LOCKFILE_FAIL_IMMEDIATELY = 0x00000001;
const LOCKFILE_EXCLUSIVE_LOCK = 0x00000002;
const ERROR_LOCK_VIOLATION = 33;

type PosixFlock = (fd: number, operation: number) => number;

let posixFlock: PosixFlock | undefined;

function loadPosixFlock(): PosixFlock {
  posixFlock ??= koffi
    .load(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : null)
    .func("int flock(int fd, int operation)") as PosixFlock;
  return posixFlock;
}

type WindowsFileLock = {
  osfhandle: (fd: number) => number | bigint;
  LockFileEx: (
    handle: number | bigint,
    flags: number,
    reserved: number,
    bytesLow: number,
    bytesHigh: number,
    overlapped: Buffer,
  ) => number;
  UnlockFileEx: (
    handle: number | bigint,
    reserved: number,
    bytesLow: number,
    bytesHigh: number,
    overlapped: Buffer,
  ) => number;
  GetLastError: () => number;
};

let windowsFileLock: WindowsFileLock | undefined;

function loadWindowsFileLock(): WindowsFileLock {
  if (windowsFileLock) return windowsFileLock;
  const kernel32 = koffi.load("kernel32.dll");
  windowsFileLock = {
    // Node's descriptor table, not a separately loaded C runtime.
    osfhandle: koffi.load(null).func("intptr_t __cdecl uv_get_osfhandle(int fd)") as (
      fd: number,
    ) => number | bigint,
    LockFileEx: kernel32.func(
      "int __stdcall LockFileEx(void *hFile, uint32_t dwFlags, uint32_t dwReserved, uint32_t nNumberOfBytesToLockLow, uint32_t nNumberOfBytesToLockHigh, void *lpOverlapped)",
    ) as WindowsFileLock["LockFileEx"],
    UnlockFileEx: kernel32.func(
      "int __stdcall UnlockFileEx(void *hFile, uint32_t dwReserved, uint32_t nNumberOfBytesToLockLow, uint32_t nNumberOfBytesToLockHigh, void *lpOverlapped)",
    ) as WindowsFileLock["UnlockFileEx"],
    GetLastError: kernel32.func("uint32_t __stdcall GetLastError()") as () => number,
  };
  return windowsFileLock;
}

function tryExclusiveLock(fd: number): boolean {
  if (process.platform === "win32") {
    const bindings = loadWindowsFileLock();
    const handle = bindings.osfhandle(fd);
    if (handle === 0 || handle === -1 || handle === -1n) {
      throw new Error("Push token lock handle is invalid.");
    }
    const overlapped = Buffer.alloc(32);
    if (
      bindings.LockFileEx(
        handle,
        LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
        0,
        1,
        0,
        overlapped,
      )
    ) {
      return true;
    }
    if (Number(bindings.GetLastError()) === ERROR_LOCK_VIOLATION) return false;
    throw new Error("Push token lock failed.");
  }
  return loadPosixFlock()(fd, LOCK_EX | LOCK_NB) === 0;
}

function unlockExclusive(fd: number): void {
  if (process.platform === "win32") {
    const bindings = loadWindowsFileLock();
    const handle = bindings.osfhandle(fd);
    bindings.UnlockFileEx(handle, 0, 1, 0, Buffer.alloc(32));
    return;
  }
  loadPosixFlock()(fd, LOCK_UN);
}

async function waitForExclusiveLock(fd: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (tryExclusiveLock(fd)) return;
    if (Date.now() - started > PUSH_TOKEN_LOCK_WAIT_MS) {
      throw new Error("Push token update timed out.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The device-token files of one account, in a stable order. */
async function listDeviceTokenFiles(dataDir: string, userId: string): Promise<string[]> {
  const dir = pushDeviceDir(dataDir, userId);
  let entries: string[] = [];
  try {
    if ((await lstat(dir)).isDirectory()) entries = await readdir(dir);
  } catch {
    entries = [];
  }
  return entries
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => path.join(dir, name));
}

/** Every token file under the push directory, both layouts. */
async function listAllTokenFiles(dataDir: string): Promise<string[]> {
  const root = path.join(dataDir, "push-tokens");
  let entries: Array<{ name: string; file: boolean; dir: boolean }> = [];
  try {
    entries = (await readdir(root, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      file: entry.isFile(),
      dir: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.file && entry.name.endsWith(".txt")) {
      files.push(path.join(root, entry.name));
      continue;
    }
    if (!entry.dir) continue;
    for (const name of await listDeviceTokenFiles(dataDir, entry.name)) files.push(name);
  }
  return files.sort();
}

export async function loadPushToken(dataDir: string, userId: string): Promise<string | undefined> {
  return (await readTokenFile(pushTokenPath(dataDir, userId)))?.token;
}

/**
 * A device token belongs to one account: saving it removes it from every other
 * user, so a handed-over device stops receiving the previous account's pushes.
 * The session check and the write are one locked step.
 */
export async function savePushToken(
  dataDir: string,
  userId: string,
  token: string,
  sessionId?: string,
  options?: SavePushTokenOptions,
): Promise<void> {
  const value = token.trim();
  await withPushTokenLock(dataDir, async () => {
    if (options?.sessionActive && !(await options.sessionActive())) {
      throw new PushSessionEndedError();
    }
    const file = pushTokenPath(dataDir, userId);
    await writeTokenFile(file, { token: value, sessionId });
    await removeTokenFromOtherOwners(dataDir, file, value, options?.beforeRemoveOthers);
  });
}

/** Registers one installation's token. Every registered device receives a push. */
export async function saveDevicePushToken(
  dataDir: string,
  userId: string,
  deviceId: string,
  token: string,
  sessionId?: string,
  options?: SavePushTokenOptions,
): Promise<void> {
  const value = token.trim();
  const file = pushDeviceTokenPath(dataDir, userId, deviceId);
  await withPushTokenLock(dataDir, async () => {
    if (options?.sessionActive && !(await options.sessionActive())) {
      throw new PushSessionEndedError();
    }
    await writeTokenFile(file, { token: value, sessionId });
    await removeTokenFromOtherOwners(dataDir, file, value, options?.beforeRemoveOthers);
  });
}

export async function deletePushToken(dataDir: string, userId: string): Promise<void> {
  await withPushTokenLock(dataDir, async () => {
    await deleteTokenFile(pushTokenPath(dataDir, userId));
  });
}

export async function deleteDevicePushToken(
  dataDir: string,
  userId: string,
  deviceId: string,
): Promise<void> {
  const file = pushDeviceTokenPath(dataDir, userId, deviceId);
  await withPushTokenLock(dataDir, async () => {
    await deleteTokenFile(file);
  });
}

/**
 * Ends the token registered by a session that is gone. The update lands only
 * when the file still holds that session, so a replacement cannot reclaim a
 * token another account has taken.
 */
export async function endSessionPushToken(
  dataDir: string,
  userId: string,
  sessionId: string,
  nextSessionId?: string,
  options?: EndSessionPushTokenOptions,
): Promise<void> {
  await withPushTokenLock(dataDir, async () => {
    const file = pushTokenPath(dataDir, userId);
    const expected = await readTokenFile(file);
    if (expected?.sessionId !== sessionId) return;
    await options?.beforeCommit?.();
    await compareAndSwapPushRecord(
      file,
      expected,
      nextSessionId ? { token: expected.token, sessionId: nextSessionId } : undefined,
    );
  });
}

/** Drops one installation's token, but only while it still holds that session. */
async function endDeviceSession(
  dataDir: string,
  file: string,
  expected: PushRecord,
): Promise<void> {
  await withPushTokenLock(dataDir, async () => {
    await compareAndSwapPushRecord(file, expected, undefined);
  });
}

async function removeTokenFromOtherOwners(
  dataDir: string,
  ownFile: string,
  token: string,
  beforeRemoveOthers?: () => Promise<void>,
): Promise<void> {
  const claimed: Array<{ file: string; record: PushRecord }> = [];
  for (const file of await listAllTokenFiles(dataDir)) {
    if (file === ownFile) continue;
    const record = await readTokenFile(file);
    if (record?.token === token) claimed.push({ file, record });
  }
  await beforeRemoveOthers?.();
  for (const other of claimed) {
    await compareAndSwapPushRecord(other.file, other.record, undefined);
  }
}

/**
 * Every token that should receive a push: each registered installation plus the legacy
 * single token, deduplicated. Reads are symlink-safe and silently skip unreadable entries.
 */
export async function loadPushTokens(dataDir: string, userId: string): Promise<string[]> {
  const tokens: string[] = [];
  for (const file of await listDeviceTokenFiles(dataDir, userId)) {
    const token = (await readTokenFile(file))?.token;
    if (token && !tokens.includes(token)) tokens.push(token);
  }
  const legacy = (await readTokenFile(pushTokenPath(dataDir, userId)))?.token;
  if (legacy && !tokens.includes(legacy)) tokens.push(legacy);
  return tokens;
}

export type ExpoPushTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

export function expoPushTickets(body: unknown): ExpoPushTicket[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return data.filter((item): item is ExpoPushTicket => Boolean(item) && typeof item === "object");
  }
  if (data && typeof data === "object") return [data as ExpoPushTicket];
  return [];
}

export function expoPushErrorMessage(body: unknown, status: number): string | undefined {
  if (body && typeof body === "object" && "errors" in body) {
    const errors = (body as { errors?: Array<{ message?: string }> }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors.map((error) => error.message ?? "expo push error").join("; ");
    }
  }
  const failed = expoPushTickets(body).filter((ticket) => ticket.status === "error");
  if (failed.length > 0) {
    return failed
      .map((ticket) => ticket.message ?? ticket.details?.error ?? "expo push ticket error")
      .join("; ");
  }
  if (status < 200 || status >= 300) return `expo push failed (${status})`;
  return undefined;
}

export class ExpoPushProvider implements NotificationProvider {
  constructor(
    private readonly dataDir: string,
    private readonly sessionExpiresAt?: PushSessionExpiresAt,
  ) {}

  describe() {
    return {
      id: "expo-push",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { push: true, email: false },
    };
  }

  async hasPushRecipient(userId: string): Promise<boolean> {
    return (await this.deliverableTokens(userId)).length > 0;
  }

  async send(message: NotificationMessage, context: AdapterContext): Promise<void> {
    await this.deliver(message, context);
  }

  /**
   * Posts the push when a token is registered. `undeliverable` means this user
   * has no token, which is not an Expo acceptance — callers must not record it
   * as a successful reminder. One stale device must not stop delivery to the
   * account's other devices, but the first failure is still reported.
   */
  async deliver(message: NotificationMessage, context: AdapterContext): Promise<ExpoPushDelivery> {
    const tokens = await this.deliverableTokens(context.userId);
    if (tokens.length === 0) return "undeliverable";
    let firstError: unknown;
    for (const token of tokens) {
      try {
        await this.sendToToken(token, message, context);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
    return "delivered";
  }

  private async sendToToken(
    token: string,
    message: NotificationMessage,
    context: AdapterContext,
  ): Promise<void> {
    const signal = combineSignals(context.signal, AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS));
    let response: Response;
    try {
      response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          to: token,
          title: message.title,
          body: message.body,
          collapseId: message.threadId,
          tag: message.threadId,
          data: expoPushData(message, context.spaceId, randomUUID()),
        }),
        signal,
      });
    } catch (error) {
      getLogger().error("expo push request failed", error);
      throw error;
    }
    const body = await readExpoPushBody(response, signal);
    if (response.ok && body === undefined) {
      throw new Error("Expo push returned an invalid response.");
    }
    const failure = expoPushErrorMessage(body, response.status);
    if (!failure) return;
    getLogger().error(failure);
    throw new Error(failure);
  }

  /**
   * A token bound to a session is delivered only while that session is still
   * live. A missing row is left for session replacement to retarget; an expired
   * row is removed. The token is read again after the lookup so a handover
   * during that wait is not sent.
   */
  private async deliverableTokens(userId: string): Promise<string[]> {
    const candidates: Array<{ file: string; record: PushRecord }> = [];
    for (const file of await listDeviceTokenFiles(this.dataDir, userId)) {
      const record = await readTokenFile(file);
      if (record) candidates.push({ file, record });
    }
    const legacyFile = pushTokenPath(this.dataDir, userId);
    const legacy = await readTokenFile(legacyFile);
    if (legacy) candidates.push({ file: legacyFile, record: legacy });

    const tokens: string[] = [];
    for (const candidate of candidates) {
      const token = await this.liveToken(candidate);
      if (token && !tokens.includes(token)) tokens.push(token);
    }
    return tokens;
  }

  private async liveToken(candidate: {
    file: string;
    record: PushRecord;
  }): Promise<string | undefined> {
    const { file, record } = candidate;
    if (!record.token) return undefined;
    if (!record.sessionId) return record.token;
    if (!this.sessionExpiresAt) return undefined;
    let expiresAt: Date | null;
    try {
      expiresAt = await this.sessionExpiresAt(record.sessionId);
    } catch (error) {
      getLogger().error("push session lookup failed", error);
      return undefined;
    }
    if (!expiresAt) return undefined;
    if (expiresAt.getTime() <= Date.now()) {
      await endDeviceSession(this.dataDir, file, record);
      return undefined;
    }
    const current = await readTokenFile(file);
    if (current?.token !== record.token || current.sessionId !== record.sessionId) return undefined;
    return current.token;
  }
}

export type ExpoPushDelivery = "delivered" | "undeliverable";

async function readExpoPushBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_EXPO_PUSH_RESPONSE_BYTES) {
    const cancel = response.body?.cancel() ?? Promise.resolve();
    await withAbort(
      cancel.catch(() => undefined),
      signal,
    ).catch(() => undefined);
    throw new Error("Expo push response is too large.");
  }
  try {
    const bytes = await readBodyCapped(response, MAX_EXPO_PUSH_RESPONSE_BYTES, signal);
    if (bytes.byteLength === 0) return undefined;
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message === "Response is too large") {
      throw new Error("Expo push response is too large.");
    }
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
