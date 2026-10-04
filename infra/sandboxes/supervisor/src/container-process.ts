import type Docker from "dockerode";
import { createDockerStreamDemuxer } from "./supervisor-logic.js";

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
 * `done` settles on stream end plus exec.inspect(), and stdin stays open.
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

  const done = new Promise<{ code: number }>((resolve, reject) => {
    stream.on("data", (data: Buffer) => {
      for (const piece of demuxer.push(data)) if (piece.data) emit(piece);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      for (const piece of demuxer.finish()) if (piece.data) emit(piece);
      // A torn hijack is not an exit: without an exit code there is nothing to clean up.
      void exec
        .inspect()
        .then((info) => resolve({ code: info.ExitCode ?? 0 }))
        .catch(reject);
    });
  });

  return {
    write: (line) =>
      new Promise<void>((resolve, reject) => {
        stream.write(line, (error) => (error ? reject(error) : resolve()));
      }),
    onOutput: (listener) => listeners.push(listener),
    kill: async () => {
      await options.runKill();
      stream.destroy();
    },
    done,
  };
}
