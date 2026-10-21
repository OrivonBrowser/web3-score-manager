import { spawn } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  /** Bytes kept of each stream; the child is stopped when stdout passes its cap. */
  maxStdout?: number;
  maxStderr?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  /** The command could not be started at all. */
  spawnError?: string;
}

/** Runs one program from an argument array (never a shell string) and collects its output. */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const maxOut = options.maxStdout ?? 4 * 1024 * 1024;
  const maxErr = options.maxStderr ?? 64 * 1024;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outSize = 0;
    let errSize = 0;
    let timedOut = false;
    let stdoutTruncated = false;
    let spawnError: string | undefined;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (outSize >= maxOut) return;
      const room = maxOut - outSize;
      out.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
      outSize += Math.min(chunk.length, room);
      if (chunk.length > room) {
        stdoutTruncated = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errSize >= maxErr) return;
      const room = maxErr - errSize;
      err.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
      errSize += Math.min(chunk.length, room);
    });
    child.on("error", (e) => {
      spawnError = e.message;
    });
    child.stdin.on("error", () => {});
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        stdoutTruncated,
        spawnError,
      });
    });
    child.stdin.end(options.stdin ?? "");
  });
}

export function failed(r: RunResult): boolean {
  return r.code !== 0 || r.timedOut || r.spawnError !== undefined;
}
