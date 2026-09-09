import { createServer, Server } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { inspectCli } from "../adapters/capabilities";
import { record, safeText } from "../core/privacy";
import { SessionMonitor } from "../monitor/sessions";
import { DebugLogs } from "./debug";
import { TaskManager } from "./manager";
import { secureDirectory } from "./paths";
import { rpc } from "./ipc";
import { StringDecoder } from "node:string_decoder";

export async function startServer(
  path: string,
  options: { home?: string; manager?: TaskManager; idleMs?: number } = {},
): Promise<{ server: Server; manager: TaskManager; close: () => Promise<void> }> {
  await secureDirectory(dirname(path));
  try {
    const existing = await lstat(path);
    if (!existing.isSocket() || (process.getuid && existing.uid !== process.getuid()))
      throw new Error("Unsafe socket path");
    let live = false;
    try {
      await rpc(path, "ping", undefined, 1000);
      live = true;
    } catch {
      /* Stale Unix socket. */
    }
    if (live) throw new Error("Supervisor already running");
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const logs = new DebugLogs(join(dirname(path), "debug"));
  const manager = options.manager ?? new TaskManager(logs);
  const monitor = new SessionMonitor(options.home ?? homedir());
  let refresh: ReturnType<SessionMonitor["refresh"]> | undefined;
  let lastRequest = Date.now();
  const dispatch = async (method: unknown, payload: unknown): Promise<unknown> => {
    const data = record(payload);
    switch (method) {
      case "ping":
        return { protocol: 1 };
      case "list": {
        refresh ??= monitor.refresh().finally(() => {
          refresh = undefined;
        });
        return { tasks: manager.list(), observed: await refresh };
      }
      case "start":
        return manager.start(payload);
      case "stop":
        manager.stop(safeText(data.id));
        return null;
      case "forget":
        manager.forget(safeText(data.id));
        return null;
      case "clear-debug":
        return { removed: await logs.clear() };
      case "inspect": {
        if (data.engine !== "claude" && data.engine !== "codex") throw new Error("Unsupported CLI");
        const cap = await inspectCli(data.engine, typeof data.executable === "string" ? data.executable : undefined);
        return { ...cap, help: {} }; // UI receives capabilities, not raw CLI output.
      }
      default:
        throw new Error("Unsupported local request");
    }
  };
  const server = createServer((socket) => {
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    let handled = false;
    socket.setTimeout(120000, () => socket.destroy());
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      if (handled) return;
      buffer += decoder.write(chunk);
      if (buffer.length > 100000) {
        socket.destroy();
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      handled = true;
      lastRequest = Date.now();
      let input: Record<string, unknown>;
      try {
        input = record(JSON.parse(buffer.slice(0, end)));
      } catch {
        socket.end(JSON.stringify({ ok: false, error: "Invalid request" }) + "\n");
        return;
      }
      buffer = "";
      void dispatch(input.method, input.payload).then(
        (data) => socket.end(JSON.stringify({ ok: true, data }) + "\n"),
        (error: unknown) =>
          socket.end(
            JSON.stringify({ ok: false, error: safeText(error instanceof Error ? error.message : "Request failed") }) +
              "\n",
          ),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await chmod(path, 0o600);
  const close = async () => {
    clearInterval(idle);
    manager.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await unlink(path);
    } catch {
      /* net.Server may already remove it. */
    }
  };
  const idle = setInterval(() => {
    if (manager.activeCount === 0 && Date.now() - lastRequest > (options.idleMs ?? 300000)) void close();
  }, 1000);
  idle.unref();
  return { server, manager, close };
}
