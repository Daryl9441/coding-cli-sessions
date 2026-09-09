import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/runtime/server";
import { rpc } from "../src/runtime/ipc";
import { runtimeDirectory, secureDirectory, socketPath } from "../src/runtime/paths";
import { fixture, request } from "./helpers";

describe("local Unix socket supervisor", () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccs-ipc-"));
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    await rm(dir, { recursive: true, force: true });
  });
  it("uses private permissions and supports real task management over IPC", async () => {
    const path = join(dir, "test.sock");
    app = await startServer(path, { home: dir });
    expect((await lstat(dir)).mode & 0o777).toBe(0o700);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    expect(await rpc(path, "ping")).toEqual({ protocol: 1 });
    expect(await rpc(path, "list")).toEqual({ tasks: [], observed: [] });
    const task = (await rpc(path, "start", request({ prompt: "hang", cwd: dir }))) as { id: string };
    expect(task.id).toBeTruthy();
    await rpc(path, "stop", { id: task.id });
    await new Promise((r) => setTimeout(r, 200));
    await rpc(path, "forget", { id: task.id });
    expect(await rpc(path, "clear-debug")).toEqual({ removed: 0 });
    const cap = (await rpc(path, "inspect", { engine: "codex", executable: fixture("codex") })) as {
      loggedIn: boolean;
      help: object;
    };
    expect(cap.loggedIn).toBe(true);
    expect(cap.help).toEqual({});
    await expect(rpc(path, "inspect", { engine: "remote" })).rejects.toThrow();
    await expect(rpc(path, "unknown")).rejects.toThrow();
    await expect(startServer(path, { home: dir })).rejects.toThrow("already running");
  });
  it("rejects unsafe filesystem endpoints", async () => {
    const path = join(dir, "test.sock");
    await writeFile(path, "must not overwrite");
    await expect(startServer(path, { home: dir })).rejects.toThrow("Unsafe");
    await symlink(dir, join(dir, "linked"));
    await expect(secureDirectory(join(dir, "linked"))).rejects.toThrow("Unsafe");
    expect(socketPath().startsWith(runtimeDirectory())).toBe(true);
  });
  it("rejects invalid JSON and bounds input without running a command", async () => {
    const path = join(dir, "test.sock");
    app = await startServer(path, { home: dir });
    const response = await new Promise<string>((resolve) => {
      const socket = createConnection(path);
      socket.on("connect", () => socket.write("not-json\n"));
      socket.on("data", (chunk) => {
        resolve(chunk.toString());
        socket.destroy();
      });
    });
    expect(response).toContain("Invalid request");
    await new Promise<void>((resolve) => {
      const socket = createConnection(path);
      socket.on("connect", () => socket.write("x".repeat(110000)));
      socket.on("close", () => resolve());
      socket.on("error", () => undefined);
    });
    expect(app.manager.list()).toEqual([]);
  });
  it("handles missing socket, timeout and invalid server responses", async () => {
    await expect(rpc(join(dir, "missing"), "ping")).rejects.toThrow("unavailable");
    const path = join(dir, "bad.sock");
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      socket.on("data", () => socket.end("not-json\n"));
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    await expect(rpc(path, "ping")).rejects.toThrow("Invalid");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const quiet = createServer((socket) => {
      socket.on("error", () => undefined);
      socket.on("data", () => undefined);
    });
    await new Promise<void>((resolve) => quiet.listen(path, resolve));
    await expect(rpc(path, "ping", undefined, 50)).rejects.toThrow("time");
    await new Promise<void>((resolve) => quiet.close(() => resolve()));
  });
});
