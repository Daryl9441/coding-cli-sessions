import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { minimalEnvironment } from "../core/privacy";

export function spawnCli(executable: string, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  if (args.some((arg) => arg.includes("\0")) || executable.includes("\0")) throw new Error("Invalid process argument");
  return spawn(executable, args, {
    cwd,
    env: minimalEnvironment(),
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** A live ChildProcess is our authority: no arbitrary PID termination API. */
export function terminateChild(child: ChildProcessWithoutNullStreams, graceMs = 1200): void {
  const signal = (name: NodeJS.Signals) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid, name);
    } catch {
      child.kill(name);
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => {
    signal("SIGKILL");
    // Descendants retaining inherited pipes must not leave a timed-out request hanging.
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  }, graceMs);
  timer.unref();
  child.once("close", () => clearTimeout(timer));
}

export async function probe(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = 10000,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnCli(executable, args, cwd);
    } catch {
      resolve({ code: -1, stdout: "", stderr: "", timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (data: Buffer) => {
      stdout = (stdout + data.toString("utf8")).slice(-256000);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString("utf8")).slice(-256000);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: "", stderr: "", timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export function spawnSupervisor(node: string, asset: string, socket: string, cwd: string): void {
  const child = spawn(node, [asset, "--socket", socket], {
    cwd,
    env: minimalEnvironment(),
    shell: false,
    detached: true,
    stdio: "ignore",
  });
  // Launch success is determined by the IPC handshake, not by an optimistic spawn result.
  child.on("error", () => undefined);
  child.unref();
}
