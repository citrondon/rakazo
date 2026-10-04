import type Docker from "dockerode";
import { createDockerStreamDemuxer } from "./supervisor-logic.js";

// A kill destroys the hijack stream, so the exec can be gone before inspect reports: resolve
// with the `kill -TERM` code (128 + SIGTERM) so a killed server still exits visibly downstream.
// The registry reports a dropped process with this same code, so it is the shared convention.
export const KILL_WITHOUT_INSPECT_EXIT_CODE = 143;

export interface ContainerProcessHandle {
  write(line: string): Promise<void>;
  onOutput(listener: (chunk: { stream: "stdout" | "stderr"; data: string }) => void): void;
  kill(): Promise<void>;
  /** Resolves once the child has exited; `code` is its exit code. */
  done: Promise<{ code: number }>;
}

/**
 * Start a long-lived duplex process in a container and hand back a live handle.
 * Structure mirrors runContainerCommand, except it does not wait for the stream:
 * `done` settles on stream end or close plus exec.inspect(), and stdin stays open.
 */
export async function startContainerProcess(
  container: Docker.Container,
  argv: string[],
  options: {
    workingDir?: string;
    env?: string[];
    /** Runs sandboxProcessKillCommand in the same container. */
    runKill: () => Promise<unknown>;
  },
): Promise<ContainerProcessHandle> {
  const exec = await container.exec({
    Cmd: argv,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: options.workingDir ?? "/home/rakazo",
    Env: options.env ?? ["HOME=/home/rakazo"],
  });
  const stream = await exec.start({ hijack: true, stdin: true });
  const demuxer = createDockerStreamDemuxer();
  const listeners: Array<(chunk: { stream: "stdout" | "stderr"; data: string }) => void> = [];
  const emit = (chunk: { stream: "stdout" | "stderr"; data: string }) => {
    for (const listener of listeners) listener(chunk);
  };

  // A destroyed stream never emits "end", so `done` settles on "end" or "close", whichever fires
  // first, exactly once. `destroying` marks a kill so a failed inspect still settles visibly.
  let settled = false;
  let destroying = false;
  const done = new Promise<{ code: number }>((resolve, reject) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const piece of demuxer.finish()) if (piece.data) emit(piece);
      exec
        .inspect()
        .then((info) => resolve({ code: info.ExitCode ?? 0 }))
        // A destroy-initiated close is a kill: resolve visibly rather than leave `done` pending.
        .catch((error) =>
          destroying ? resolve({ code: KILL_WITHOUT_INSPECT_EXIT_CODE }) : reject(error),
        );
    };
    // A torn hijack is not an exit: reject so a broken stream is never read as a clean exit.
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    stream.on("data", (data: Buffer) => {
      for (const piece of demuxer.push(data)) if (piece.data) emit(piece);
    });
    stream.on("error", fail);
    stream.on("end", finish);
    stream.on("close", finish);
  });

  return {
    write: (line) =>
      new Promise<void>((resolve, reject) => {
        stream.write(line, (error) => (error ? reject(error) : resolve()));
      }),
    onOutput: (listener) => listeners.push(listener),
    kill: async () => {
      await options.runKill();
      // Mark the destroy before tearing the stream down so a lost exec resolves with the kill code.
      destroying = true;
      stream.destroy();
    },
    done,
  };
}
