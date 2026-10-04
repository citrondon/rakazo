import type { ProcessEvent, SandboxProcess } from "@rakazo/adapter-kit";

type Queued = { event: ProcessEvent } | { end: true };
/** Das Handle plus die Buchführung, die der Vertrag nicht hergibt. */
export type FakeProcess = SandboxProcess & { killCalls: number; writes: string[] };

export function fakeSandboxProcess() {
  const queue: Queued[] = [];
  const writes: string[] = [];
  const errors: Error[] = [];
  const killState = { calls: 0 };
  let notify: (() => void) | undefined;
  const wake = () => {
    const fn = notify;
    notify = undefined;
    fn?.();
  };
  const push = (item: Queued) => {
    queue.push(item);
    wake();
  };

  const handle: FakeProcess = {
    id: "proc-fake",
    writes,
    get killCalls() {
      return killState.calls;
    },
    write: async (line: string) => {
      writes.push(line);
    },
    events: async function* () {
      for (;;) {
        while (queue.length === 0) await new Promise<void>((resolve) => (notify = resolve));
        const next = queue.shift() as Queued;
        if ("end" in next) return;
        yield next.event;
      }
    },
    kill: async () => {
      killState.calls += 1;
      push({ end: true });
    },
  };

  return {
    handle,
    errors,
    emitStdout: (data: string) => push({ event: { type: "stdout", data } }),
    emitStderr: (data: string) => push({ event: { type: "stderr", data } }),
    emitExit: (code: number) => {
      push({ event: { type: "exit", code } });
      push({ end: true });
    },
  };
}

/** Gibt dem Fake-Handle Gelegenheit, seine wartende Iteration aufzulösen. */
export const flush = () => new Promise((resolve) => setImmediate(resolve));
