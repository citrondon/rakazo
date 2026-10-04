import type { Logger } from "@rakazo/logging";
import type { ContainerProcessHandle } from "./container-process.js";
import { KILL_WITHOUT_INSPECT_EXIT_CODE } from "./container-process.js";

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
  /**
   * The channel's identity check: an entry answers only to the computer and bot that own it,
   * so a processId can never open a window into another computer's process. A process that
   * has ended answers `undefined` here — the reader distinguishes it from unknown via `wasEnded`.
   */
  get(id: string, computerId: string, botId: string): RegisteredProcess | undefined;
  /**
   * True while the ended marker of a once-running process stands, and only for its owner:
   * it is what lets the events route answer 410 "process ended" instead of a stream that hangs,
   * while a stranger still sees 404, and it is terminal — nothing resurrects an ended process.
   */
  wasEnded(id: string, computerId: string, botId: string): boolean;
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
  /** Set once a started process ended; the entry stays as the marker until the idle sweep takes it. */
  ended: boolean;
  handle?: ContainerProcessHandle;
  process?: RegisteredProcess;
  /** Empty while no reader holds the process. */
  readerId: string;
  onEvent?: ReaderSink;
  lastActivity: number;
}

export function createProcessRegistry(
  options: { idleMs?: number; logger?: Pick<Logger, "warn"> } = {},
): ProcessRegistry {
  const idleMs = options.idleMs ?? MCP_PROCESS_IDLE_MS;
  const entries = new Map<string, Entry>();
  // A fire-and-forget kill can reject over the Docker API; the supervisor runs with
  // --unhandled-rejections=throw, so a swallowed error still needs to reach the host log.
  const warn = (message: string, error: unknown) => {
    options.logger?.warn(message, { error });
  };

  const forget = (entry: Entry) => {
    if (entries.get(entry.id) === entry) entries.delete(entry.id);
  };

  /** The stored owner read from the entry: the identity check of the whole channel. */
  const owned = (
    table: Map<string, Entry>,
    id: string,
    computerId: string,
    botId: string,
  ): Entry | undefined => {
    const entry = table.get(id);
    if (!entry || entry.computerId !== computerId || entry.botId !== botId) return undefined;
    return entry;
  };

  /** Ends the process, its reservation, and its reader slot, then tells the reader why. */
  const drop = async (entry: Entry, reason: string) => {
    if (entry.ended) return;
    entry.released = true;
    if (entry.process) {
      // A process that actually ran leaves the ended marker behind, so the reader of the
      // events route learns 410 "ended" instead of a 404 that hides a real past process.
      entry.ended = true;
      entry.lastActivity = Date.now();
    } else {
      // A reservation that never became a visible process stays unknown to every reader.
      forget(entry);
    }
    const onEvent = entry.onEvent;
    entry.readerId = "";
    entry.onEvent = undefined;
    if (entry.handle) await entry.handle.kill();
    if (!onEvent) return;
    onEvent({ type: "stderr", data: `process closed: ${reason}\n` });
    // Spec 4.1 ends the event stream with exit: the process was killed here, and a killed
    // child resolves with the SIGTERM code by the container-process convention.
    onEvent({ type: "exit", code: KILL_WITHOUT_INSPECT_EXIT_CODE });
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
        ended: false,
        readerId: "",
        lastActivity: Date.now(),
      };
      entries.set(input.id, entry);
      return {
        id: input.id,
        attach(handle) {
          if (entry.released || entries.get(input.id) !== entry) {
            // The reservation went away during the start: the process that just came up has no
            // owner, so it is terminated instead of being handed out as if it were alive. The kill
            // is a Docker call that can reject, and this is fire-and-forget, so it is caught and
            // logged rather than left to bring the supervisor down on an unhandled rejection.
            void handle.kill().catch((error: unknown) => {
              warn("supervisor process kill failed after late attach", error);
            });
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
              // Resolved exit: the child is gone; the ended marker answers the reader with 410.
              entry.released = true;
              entry.ended = true;
              entry.lastActivity = Date.now();
              entry.onEvent?.({ type: "exit", code: exit.code });
            },
            // A torn stream never yields an exit code; the reader still has to stop waiting.
            () => {
              // Rejecting differs from resolving: only the stream tore, so the child is likely
              // still alive and killable over the Docker API. Best-effort kill it before ending
              // the entry, or it keeps running in the sandbox until the ten minute suspension caps it.
              void entry.handle?.kill().catch(() => {});
              entry.released = true;
              entry.ended = true;
              entry.lastActivity = Date.now();
              entry.onEvent?.({ type: "stderr", data: "process stream lost\n" });
              // The event stream must end with exit (spec 4.1); an unknown code reads as failure.
              entry.onEvent?.({ type: "exit", code: 1 });
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
    get(id, computerId, botId) {
      const entry = owned(entries, id, computerId, botId);
      return entry && !entry.ended ? entry.process : undefined;
    },
    wasEnded(id, computerId, botId) {
      return owned(entries, id, computerId, botId)?.ended === true;
    },
    async release(id, readerId, reason) {
      const entry = entries.get(id);
      if (!entry) return;
      if (entry.readerId !== "" && entry.readerId !== readerId) return;
      await drop(entry, reason);
    },
    async sweep(now = Date.now()) {
      const stale = [...entries.values()].filter((entry) => now - entry.lastActivity > idleMs);
      const running = stale.filter((entry) => !entry.ended);
      await Promise.all(running.map((entry) => drop(entry, "idle timeout")));
      // The ended marker has served its reader by now; past the idle window it goes,
      // and the process table holds no more than the entries of this process' lifetime.
      for (const entry of stale) if (entry.ended) forget(entry);
      return running.map((entry) => entry.id);
    },
  };
}
