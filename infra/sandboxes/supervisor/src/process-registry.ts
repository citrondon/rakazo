import type { ContainerProcessHandle } from "./container-process.js";

/** Idle window per long-lived process, comfortably under the 10 minute computer suspension. */
export const MCP_PROCESS_IDLE_MS = 240_000;

/** NDJSON event shape shared with the exec stream: stdout, stderr, or exit. */
export type ProcessEventLike =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number };

export interface RegisteredProcess {
  id: string;
  write(line: string): Promise<void>;
  /** Takes the single reader. A second call does not evict the first. */
  attachReader(readerId: string, onEvent: (event: ProcessEventLike) => void): () => void;
  kill(reason: string): Promise<void>;
}

export interface ProcessRegistry {
  claim(input: {
    id: string;
    computerId: string;
    botId: string;
    handle: ContainerProcessHandle;
  }): RegisteredProcess;
  get(id: string): RegisteredProcess | undefined;
  /** Removes only when the same reader releases; otherwise the handle stays. */
  release(id: string, readerId: string, reason: string): Promise<void>;
  sweep(now?: number): Promise<string[]>;
}

interface Entry {
  id: string;
  computerId: string;
  botId: string;
  handle: ContainerProcessHandle;
  reader: { id: string; onEvent?: (event: ProcessEventLike) => void };
  lastActivity: number;
  process: RegisteredProcess;
}

export function createProcessRegistry(options: { idleMs?: number } = {}): ProcessRegistry {
  const idleMs = options.idleMs ?? MCP_PROCESS_IDLE_MS;
  const entries = new Map<string, Entry>();

  const touch = (entry: Entry) => {
    entry.lastActivity = Date.now();
  };

  const forget = (id: string) => {
    entries.delete(id);
  };

  const release = async (id: string, readerId: string, reason: string) => {
    const entry = entries.get(id);
    if (!entry || entry.reader.id !== readerId) return;
    const onEvent = entry.reader.onEvent;
    entry.reader = { id: "" };
    forget(id);
    await entry.handle.kill();
    onEvent?.({ type: "stderr", data: `process closed: ${reason}\n` });
  };

  const processFor = (entry: Entry): RegisteredProcess => ({
    id: entry.id,
    write: async (line) => {
      touch(entry);
      await entry.handle.write(line);
    },
    attachReader: (readerId, onEvent) => {
      entry.reader = { id: readerId, onEvent };
      touch(entry);
      return () => {
        if (entry.reader.id !== readerId) return;
        void release(entry.id, readerId, "reader detached");
      };
    },
    kill: (reason) => release(entry.id, entry.reader.id, reason),
  });

  return {
    claim(input) {
      const entry: Entry = {
        id: input.id,
        computerId: input.computerId,
        botId: input.botId,
        handle: input.handle,
        reader: { id: "" },
        lastActivity: Date.now(),
        process: undefined as never,
      };
      entry.process = processFor(entry);
      entries.set(input.id, entry);
      input.handle.onOutput((chunk) => {
        touch(entry);
        entry.reader.onEvent?.({ type: chunk.stream, data: chunk.data });
      });
      void input.handle.done.then((result) => {
        touch(entry);
        entry.reader.onEvent?.({ type: "exit", code: result.code });
        forget(input.id);
      });
      return entry.process;
    },
    get: (id) => entries.get(id)?.process,
    release: (id, readerId, reason) => release(id, readerId, reason),
    async sweep(now = Date.now()) {
      const expired = [...entries.values()].filter((entry) => now - entry.lastActivity > idleMs);
      await Promise.all(
        expired.map(async (entry) => {
          forget(entry.id);
          await entry.handle.kill();
        }),
      );
      return expired.map((entry) => entry.id);
    },
  };
}
