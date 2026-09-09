import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskManager } from "../src/runtime/manager";
import { DebugLogs } from "../src/runtime/debug";
import { inspectCli } from "../src/adapters/capabilities";
import { Capabilities } from "../src/core/types";
import { fixture, request, settled } from "./helpers";

describe("supervisor with executable fixtures (no paid APIs)", () => {
  let dir: string;
  let manager: TaskManager;
  let logs: DebugLogs;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccs-test-"));
    logs = new DebugLogs(join(dir, "debug"));
    manager = new TaskManager(logs);
  });
  afterEach(async () => {
    manager.shutdown();
    await new Promise((r) => setTimeout(r, 80));
    await rm(dir, { recursive: true, force: true });
  });

  it.each(["claude", "codex"] as const)("runs and resumes %s with real stdout chunk handling", async (engine) => {
    const first = await manager.start(request({ engine, executable: fixture(engine), prompt: "chunks", cwd: dir }));
    const task = await settled(manager, first.id);
    expect(task.state).toBe("completed");
    expect(task.sessionId).toBeTruthy();
    expect(JSON.stringify(task)).toContain("你好");
    expect(JSON.stringify(task)).toContain("[REDACTED]");
    expect(JSON.stringify(task)).not.toContain("z".repeat(30));
    expect(await readdir(dir)).toEqual([]);
    const resumed = await manager.start(
      request({ engine, executable: fixture(engine), resume: task.sessionId, cwd: dir }),
    );
    expect((await settled(manager, resumed.id)).state).toBe("completed");
  });
  it.each([
    ["failure", "failed"],
    ["missing-result", "failed"],
    ["killed", "interrupted"],
    ["hang", "timed-out"],
    ["ignore-term", "timed-out"],
  ])("handles %s without a false success", async (prompt, expected) => {
    const task = await manager.start(request({ prompt, timeoutMs: 150, cwd: dir }));
    expect((await settled(manager, task.id)).state).toBe(expected);
  });
  it("tracks parallel tasks independently and stops only owned tasks", async () => {
    const [one, two] = await Promise.all([
      manager.start(request({ prompt: "hang", cwd: dir })),
      manager.start(request({ prompt: "hang", cwd: dir })),
    ]);
    expect(manager.activeCount).toBe(2);
    expect(() => manager.stop("arbitrary-external-pid")).toThrow();
    expect(() => manager.forget(one.id)).toThrow();
    manager.stop(one.id);
    manager.stop(two.id);
    expect((await settled(manager, one.id)).state).toBe("cancelled");
    expect(manager.list().find((t) => t.id === two.id)?.state).toBe("cancelled");
    manager.forget(one.id);
    manager.forget("unknown");
    expect(manager.list()).toHaveLength(1);
  });
  it("rejects duplicate running-session resumes and concurrency overflow", async () => {
    const task = await manager.start(request({ prompt: "hang", cwd: dir }));
    await new Promise((r) => setTimeout(r, 100));
    const sessionId = manager.list()[0].sessionId!;
    await expect(manager.start(request({ resume: sessionId, cwd: dir }))).rejects.toThrow("already");
    const limited = new TaskManager(logs, inspectCli, 0);
    await expect(limited.start(request())).rejects.toThrow("limit");
    manager.stop(task.id);
    await settled(manager, task.id);
  });
  it("does not inherit parent secrets or store prompts in its task model", async () => {
    process.env.CCS_TEST_SECRET = "sensitive-but-not-real";
    const task = await manager.start(request({ prompt: "environment", cwd: dir }));
    delete process.env.CCS_TEST_SECRET;
    const result = await settled(manager, task.id);
    expect(JSON.stringify(result)).toContain('inheritedSecret\\":false');
    expect(result).not.toHaveProperty("prompt");
  });
  it("writes only opt-in diagnostic metadata and clears only its files", async () => {
    const task = await manager.start(request({ debug: true, cwd: dir }));
    await settled(manager, task.id);
    await new Promise((r) => setTimeout(r, 30));
    const files = await readdir(logs.directory);
    expect(files).toHaveLength(1);
    const text = await readFile(join(logs.directory, files[0]), "utf8");
    expect(text).not.toContain("Fixture work");
    expect(text).not.toContain("prompt");
    expect(await logs.clear()).toBe(1);
    expect(await logs.clear()).toBe(0);
    await expect(logs.write("../invalid", { kind: "test", state: "test" })).rejects.toThrow();
  });
  it("handles executable disappearance after capability probing", async () => {
    const cap = await inspectCli("claude", fixture("claude"));
    manager = new TaskManager(logs, async () => ({ ...cap, executable: "/missing/fixture" }) as Capabilities);
    const task = await manager.start(request({ cwd: dir }));
    expect((await settled(manager, task.id)).state).toBe("failed");
    await expect(manager.start(request({ cwd: join(dir, "missing") }))).rejects.toThrow();
  });
  it("bounds a large structured tool stream while preserving its latest result", async () => {
    const task = await manager.start(request({ prompt: "large-stream", cwd: dir }));
    const result = await settled(manager, task.id);
    expect(result.state).toBe("completed");
    expect(JSON.stringify(result).length).toBeLessThan(25000);
    expect(result.events.at(-1)?.kind).toBe("completed");
    expect(JSON.stringify(result)).toContain("tool-399-");
  });
  it("prevents concurrent resumes while capability checks are still pending", async () => {
    const results = await Promise.allSettled([
      manager.start(request({ resume: "last", prompt: "hang", cwd: dir })),
      manager.start(request({ resume: "last", prompt: "hang", cwd: dir })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("terminates the fixture process group including its child", async () => {
    const task = await manager.start(request({ prompt: "child-tree", cwd: dir }));
    let pid = 0;
    for (let attempt = 0; attempt < 50 && !pid; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      pid = Number(JSON.stringify(manager.list()).match(/child-pid:(\d+)/)?.[1]);
    }
    expect(pid).toBeGreaterThan(0);
    manager.stop(task.id);
    await settled(manager, task.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it("refuses debug symlinks and never serializes extra metadata fields", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const target = join(dir, "untouched");
    await writeFile(target, "original");
    await logs.write(id, { kind: "test", state: "running", prompt: "NOT ACCEPTED" } as never);
    expect(await readFile(join(logs.directory, `debug-${id}.jsonl`), "utf8")).not.toContain("NOT ACCEPTED");
    await logs.clear();
    await symlink(target, join(logs.directory, `debug-${id}.jsonl`));
    await expect(logs.write(id, { kind: "test", state: "running" })).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("original");
  });
});
