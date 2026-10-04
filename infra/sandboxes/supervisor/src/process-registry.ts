import type { ContainerProcessHandle } from "./container-process.js";

/** Idle window per long-lived process, comfortably under the ten minute computer suspension. */
export const MCP_PROCESS_IDLE_MS = 240_000;

/** NDJSON event shape shared with the exec stream: stdout, stderr, or exit. */
export type ProcessEventLike =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number };

type ReaderSink = (event: ProcessEventLike) => void;

export interface RegisteredProcess {
  id: string;
  write(line: string): Promise<void>;
  /** Takes the single reader slot. A second call replaces the reader, it never evicts the process. */
  attachReader(readerId: string, onEvent: ReaderSink): () => void;
  kill(reason: string): Promise<void>;
}

/**
 * A reservation exists before the child process is started, so a close that lands in that window
 * always finds an entry — and `attach` has to be able to kill the handle it is handed.
 */
export interface ReservedProcess {
  readonly id: string;
  /**
   * Commits the reservation. If it was released in the meantime, the handle is terminated straight
   * away and the result is `undefined`, which is what lets the route answer `409`.
   */
  attach(handle: ContainerProcessHandle): RegisteredProcess | undefined;
  /** The start itself failed: entry gone, nothing to kill. */
  abort(): void;
}

export interface ProcessRegistry {
  reserve(input: { id: string; computerId: string; botId: string }): ReservedProcess;
  get(id: string): RegisteredProcess | undefined;
  /**
   * Removes only when the requester is the attached reader, or when no reader is attached at all:
   * killing a process that is starting, or already readerless, is an operator action.
   */
  release(id: string, readerId: string, reason: string): Promise<void>;
  sweep(now?: number): Promise<string[]>;
}

interface Entry {
  id: string;
  computerId: string;
  botId: string;
  released: boolean;
  handle?: ContainerProcessHandle;
  process?: RegisteredProcess;
  /** Empty while no reader holds the process. */
  readerId: string;
  onEvent?: ReaderSink;
  lastActivity: number;
}

export function createProcessRegistry(options: { idleMs?: number } = {}): ProcessRegistry {
  const idleMs = options.idleMs ?? MCP_PROCESS_IDLE_MS;
  const entries = new Map<string, Entry>();

  const forget = (entry: Entry) => {
    if (entries.get(entry.id) === entry) entries.delete(entry.id);
  };

  /** Ends the process, its reservation, and its reader slot, then tells the reader why. */
  const drop = async (entry: Entry, reason: string) => {
    entry.released = true;
    forget(entry);
    const onEvent = entry.onEvent;
    entry.readerId = "";
    entry.onEvent = undefined;
    if (entry.handle) await entry.handle.kill();
    onEvent?.({ type: "stderr", data: `process closed: ${reason}\n` });
  };

  const processFor = (entry: Entry, handle: ContainerProcessHandle): RegisteredProcess => ({
    id: entry.id,
    write: async (line) => {
      entry.lastActivity = Date.now();
      await handle.write(line);
    },
    attachReader: (readerId, onEvent) => {
      entry.readerId = readerId;
      entry.onEvent = onEvent;
      entry.lastActivity = Date.now();
      return () => {
        // Identity check: a displaced reader must not clear the reader that replaced it.
        if (entry.readerId !== readerId) return;
        entry.readerId = "";
        entry.onEvent = undefined;
      };
    },
    kill: (reason) => drop(entry, reason),
  });

  return {
    reserve(input) {
      const entry: Entry = {
        ...input,
        released: false,
        readerId: "",
        lastActivity: Date.now(),
      };
      entries.set(input.id, entry);
      return {
        id: input.id,
        attach(handle) {
          if (entry.released || entries.get(input.id) !== entry) {
            // The reservation went away during the start: the process that just came up has no
            // owner, so it is terminated instead of being handed out as if it were alive.
            void handle.kill();
            return undefined;
          }
          entry.handle = handle;
          entry.process = processFor(entry, handle);
          // Output meets whichever reader is current: neither a displaced reader nor a missing one
          // gets a frame, and no frame is ever dropped.
          handle.onOutput((chunk) => {
            entry.lastActivity = Date.now();
            entry.onEvent?.({ type: chunk.stream, data: chunk.data });
          });
          void handle.done.then(
            (exit) => {
              entry.lastActivity = Date.now();
              entry.onEvent?.({ type: "exit", code: exit.code });
              forget(entry);
            },
            // A torn stream never yields an exit code; the reader still has to stop waiting.
            () => {
              forget(entry);
              entry.onEvent?.({ type: "stderr", data: "process stream lost\n" });
            },
          );
          return entry.process;
        },
        abort() {
          entry.released = true;
          forget(entry);
        },
      };
    },
    get: (id) => entries.get(id)?.process,
    async release(id, readerId, reason) {
      const entry = entries.get(id);
      if (!entry) return;
      if (entry.readerId !== "" && entry.readerId !== readerId) return;
      await drop(entry, reason);
    },
    async sweep(now = Date.now()) {
      const expired = [...entries.values()].filter((entry) => now - entry.lastActivity > idleMs);
      await Promise.all(expired.map((entry) => drop(entry, "idle timeout")));
      return expired.map((entry) => entry.id);
    },
  };
}
