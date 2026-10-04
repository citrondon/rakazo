import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { SandboxProcess } from "@rakazo/adapter-kit";

/**
 * Bounds adopted from the design spec (4.2): stdout may never drop a frame, so an
 * unterminated buffer beyond this size ends the session instead of discarding bytes.
 */
export const MCP_STDIO_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** stderr is diagnostics: trimmed while it arrives, with an explicit truncated flag. */
export const MCP_STDIO_MAX_STDERR_BYTES = 64 * 1024;

export interface SandboxStdioTransportOptions {
  maxBufferedBytes?: number;
  maxStderrBytes?: number;
}

/**
 * Speaks newline-delimited JSON-RPC over a long-lived sandbox process handle, exactly
 * the framing `StdioClientTransport` uses on the host — a real transport, not a pipe
 * illusion. One writer per process: sends are serialized behind each other. A stdin
 * rejection, a protocol error, or a non-zero exit reaches the caller as a dead
 * process; nothing is retried or swallowed.
 *
 * Containment caveat (design spec 1): the computer shares the bot's home mount, so
 * this channel contains network and credentials, not the filesystem.
 */
export class SandboxStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly process: SandboxProcess;
  private readonly maxBufferedBytes: number;
  private readonly maxStderrBytes: number;
  /** The incomplete tail of a stdout frame, kept between events; never dropped. */
  private buffered = "";
  private stderrTail = "";
  private stderrBytes = 0;
  private stderrTruncated = false;
  /** The single writer: each send chains behind the previous frame's acknowledgement. */
  private tail: Promise<void> = Promise.resolve();
  private started = false;
  private closed = false;
  private exited = false;

  constructor(process: SandboxProcess, options: SandboxStdioTransportOptions = {}) {
    this.process = process;
    this.maxBufferedBytes = options.maxBufferedBytes ?? MCP_STDIO_MAX_BUFFERED_BYTES;
    this.maxStderrBytes = options.maxStderrBytes ?? MCP_STDIO_MAX_STDERR_BYTES;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("SandboxStdioTransport is already started");
    if (this.closed) throw new Error("SandboxStdioTransport is closed");
    this.started = true;
    // Exactly one `for await` over events(); the read loop outlives start() itself,
    // which the SDK handshake must not wait for.
    void this.readEvents();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error("SandboxStdioTransport is closed");
    const line = `${JSON.stringify(message)}\n`;
    const queued = this.tail.then(async () => {
      if (this.closed) throw new Error("SandboxStdioTransport is closed");
      await this.process.write(line);
    });
    this.tail = queued.then(
      () => undefined,
      (error: unknown) => {
        // A rejected frame means the process is gone; report it once, then every
        // later send fails as closed. No retry, no swallow.
        if (!this.closed) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
    await queued;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (!this.exited) await this.process.kill();
    this.closeSession();
  }

  private async readEvents(): Promise<void> {
    try {
      for await (const event of this.process.events()) {
        // After close the stream is drained into the void; nothing is delivered.
        if (this.closed) continue;
        if (event.type === "stdout") this.handleStdout(event.data);
        else if (event.type === "stderr") this.handleStderr(event.data);
        else this.handleExit(event.code);
      }
    } catch (error) {
      if (!this.closed) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (!this.closed) this.closeSession();
  }

  private handleStdout(data: string): void {
    this.buffered += data;
    for (;;) {
      const newline = this.buffered.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffered.slice(0, newline);
      this.buffered = this.buffered.slice(newline + 1);
      if (!line) continue;
      let message: JSONRPCMessage;
      try {
        message = JSON.parse(line) as JSONRPCMessage;
      } catch {
        // A non-JSON line means the stream is corrupted; guessing or dropping it
        // would break the pending request, so the process dies visibly.
        this.fail(new Error("Sandbox stdio received a stdout frame that is not JSON"));
        return;
      }
      this.onmessage?.(message);
    }
    if (Buffer.byteLength(this.buffered, "utf8") > this.maxBufferedBytes) {
      this.fail(
        new Error(
          `Sandbox stdio buffered an unterminated stdout frame beyond ${this.maxBufferedBytes} bytes`,
        ),
      );
    }
  }

  private handleStderr(data: string): void {
    if (this.stderrTruncated) return;
    let remaining = this.maxStderrBytes - this.stderrBytes;
    if (remaining <= 0) {
      this.stderrTruncated = true;
      return;
    }
    let kept = "";
    for (const char of data) {
      const size = Buffer.byteLength(char, "utf8");
      if (size > remaining) {
        this.stderrTruncated = true;
        break;
      }
      kept += char;
      remaining -= size;
    }
    this.stderrTail += kept;
    this.stderrBytes += Buffer.byteLength(kept, "utf8");
  }

  private handleExit(code: number): void {
    this.exited = true;
    if (code === 0) return;
    const truncated = this.stderrTruncated ? " (stderr truncated)" : "";
    const detail = this.stderrTail ? `: stderr: ${this.stderrTail}` : "";
    this.fail(new Error(`Sandbox stdio process exited with code ${code}${truncated}${detail}`));
  }

  private fail(error: Error): void {
    this.onerror?.(error);
    if (!this.exited) {
      // The session is already reporting its death through onerror; a kill that
      // itself fails must not turn into an unhandled rejection.
      void this.process.kill().catch(() => undefined);
    }
    this.closeSession();
  }

  private closeSession(): void {
    if (this.closed) return;
    this.closed = true;
    // Remove the delivery listeners: whatever still arrives runs into the void.
    this.onmessage = undefined;
    this.onerror = undefined;
    this.onclose?.();
  }
}
