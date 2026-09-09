import { afterEach, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { rpc } from "../src/runtime/ipc";
import { fixture, request } from "./helpers";
import { Task } from "../src/core/types";

let root: string | undefined;
let child: ChildProcess | undefined;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise<void>((done) => child!.once("close", () => done()));
    child.kill("SIGTERM");
    await closed;
  }
  if (root) await rm(root, { recursive: true, force: true });
});

it("runs the shipped supervisor bundle and retains a fixture task between independent IPC clients", async () => {
  root = await mkdtemp("/tmp/ccs-bundle-");
  const socket = join(root, `ccs-${process.getuid?.() ?? "local"}`, "supervisor.sock");
  child = spawn(process.execPath, [resolve("assets/supervisor.cjs"), "--socket", socket], {
    shell: false,
    cwd: root,
    env: { HOME: root, TMPDIR: root, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
    stdio: "ignore",
  });
  let ready = false;
  for (let attempt = 0; attempt < 50 && !ready; attempt++) {
    try {
      await rpc(socket, "ping", undefined, 300);
      ready = true;
    } catch {
      await new Promise((done) => setTimeout(done, 20));
    }
  }
  expect(ready).toBe(true);
  const task = (await rpc(
    socket,
    "start",
    request({ cwd: root, prompt: "slow", executable: fixture("claude") }),
  )) as Task;
  // Every rpc call closes its own client connection; task ownership belongs to the bundle.
  let snapshot: { tasks: Task[]; observed: unknown[] } = { tasks: [], observed: [] };
  for (let attempt = 0; attempt < 50; attempt++) {
    snapshot = (await rpc(socket, "list")) as typeof snapshot;
    if (snapshot.tasks[0]?.state === "completed") break;
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(snapshot.tasks[0]).toMatchObject({ id: task.id, state: "completed", persistSession: false });
  expect(snapshot.observed).toEqual([]);
  expect(JSON.stringify(snapshot)).toContain("No external API calls were made");
});
