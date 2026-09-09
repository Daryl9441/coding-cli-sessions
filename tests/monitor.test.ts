import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFile, mkdir, mkdtemp, rm, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedSessionPath, discoverSessionFiles, openSession, sessionRoot } from "../src/monitor/files";
import { SessionTailer } from "../src/monitor/tailer";
import { SessionMonitor } from "../src/monitor/sessions";
import { encodeClaudeCwd } from "../src/monitor/claude-path";

const id = "12345678-1234-4234-8234-123456789abc";
describe("read-only transcript monitoring", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "ccs-monitor-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });
  const claudePath = (home: string) => join(sessionRoot(home, "claude"), encodeClaudeCwd("/tmp/notes"), `${id}.jsonl`);
  const codexPath = (home: string) =>
    join(sessionRoot(home, "codex"), "2026", "09", "09", `rollout-2026-09-09T10-20-30-${id}.jsonl`);
  async function file(path: string, data: string) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, data);
  }

  it("limits filesystem access to named transcripts in the two allowed roots", async () => {
    expect(allowedSessionPath(home, "claude", claudePath(home))).toBe(true);
    expect(allowedSessionPath(home, "codex", codexPath(home))).toBe(true);
    for (const path of [
      join(home, ".codex/auth.json"),
      join(home, ".claude/.credentials.json"),
      join(home, "elsewhere", `${id}.jsonl`),
      join(sessionRoot(home, "codex"), "auth.jsonl"),
      sessionRoot(home, "codex"),
    ]) {
      expect(allowedSessionPath(home, "codex", path)).toBe(false);
      await expect(openSession(home, "codex", path)).rejects.toThrow("allowed");
    }
    const path = claudePath(home);
    await mkdir(join(path, ".."), { recursive: true });
    await symlink("/not-accessed", path);
    await expect(openSession(home, "claude", path)).rejects.toThrow("symlink");
    expect(await discoverSessionFiles(home)).toEqual([]);
  });
  it("discovers nested Codex files and ignores symlinked directories and unrelated JSON", async () => {
    await file(claudePath(home), "{}\n");
    await file(codexPath(home), "{}\n");
    await file(join(sessionRoot(home, "codex"), "unrelated.json"), "never read");
    await symlink(home, join(sessionRoot(home, "codex"), "link"));
    const found = await discoverSessionFiles(home);
    expect(found).toHaveLength(2);
    expect(await discoverSessionFiles(home, 1)).toHaveLength(1);
  });
  it("tails append-only bytes, completes partial Unicode records, and recovers from truncation and deletion", async () => {
    const path = claudePath(home);
    await file(path, '{"initial":true}\n');
    const tail = new SessionTailer(home, { path, engine: "claude", mtime: 0 });
    const values: unknown[] = [];
    expect(await tail.poll((v) => values.push(v))).toBe(true);
    const bytes = Buffer.from('{"text":"你好"}\n');
    await appendFile(path, bytes.subarray(0, 11));
    await tail.poll((v) => values.push(v));
    expect(values).toHaveLength(1);
    await appendFile(path, bytes.subarray(11));
    await tail.poll((v) => values.push(v));
    expect(values.at(-1)).toEqual({ text: "你好" });
    await truncate(path);
    await appendFile(path, '{"new":1}\n');
    await tail.poll((v) => values.push(v));
    expect(values.at(-1)).toEqual({ new: 1 });
    await unlink(path);
    expect(await tail.poll(() => undefined)).toBe(false);
    await file(path, '{"replacement":true}\n');
    expect(await tail.poll((v) => values.push(v))).toBe(true);
    expect(values.at(-1)).toEqual({ replacement: true });
  });
  it("bounds large backlogs and ignores malformed lines", async () => {
    const path = claudePath(home);
    await file(path, '{"meta":1}\n' + "x".repeat(200) + '\nnot-json\n{"latest":1}\n');
    const tail = new SessionTailer(home, { path, engine: "claude", mtime: 0 }, 64);
    const values: unknown[] = [];
    await tail.poll((v) => values.push(v));
    expect(values).toContainEqual({ latest: 1 });
    await appendFile(path, "x".repeat(100));
    await tail.poll((v) => values.push(v));
    await appendFile(path, '\n{"latest":2}\n');
    await tail.poll((v) => values.push(v));
    expect(values).toContainEqual({ latest: 2 });
  });
  it("extracts only session metadata and semantic activity, never prompts", async () => {
    await file(
      claudePath(home),
      JSON.stringify({ type: "user", sessionId: id, cwd: "/project", message: { content: "PRIVATE PROMPT" } }) +
        "\n" +
        JSON.stringify({ type: "assistant", message: { content: [{ text: "PRIVATE ANSWER" }] } }) +
        "\n",
    );
    await file(
      codexPath(home),
      JSON.stringify({ type: "session_meta", payload: { id, cwd: "/codex-project" } }) +
        "\n" +
        JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }) +
        "\n",
    );
    const monitor = new SessionMonitor(home);
    let sessions = await monitor.refresh();
    expect(sessions).toHaveLength(2);
    expect(JSON.stringify(sessions)).not.toContain("PRIVATE");
    expect(sessions.every((s) => s.activity === "recent-activity")).toBe(true);
    await appendFile(claudePath(home), '{"type":"progress"}\n{"type":"result"}\n');
    await appendFile(
      codexPath(home),
      '{"type":"event_msg","payload":{"type":"agent_message"}}\n{"type":"event_msg","payload":{"type":"task_complete"}}\n',
    );
    sessions = await monitor.refresh();
    expect(sessions.every((s) => s.activity === "completed")).toBe(true);
    await appendFile(claudePath(home), '{"type":"assistant"}\n');
    sessions = await monitor.refresh();
    expect(sessions.find((s) => s.engine === "claude")?.activity).toBe("recent-activity");
    await unlink(claudePath(home));
    sessions = await monitor.refresh();
    expect(sessions.some((s) => s.activity === "unavailable")).toBe(true);
    sessions = await monitor.refresh(Date.now() + 20000);
    expect(sessions).toHaveLength(1);
  });
  it("marks stale logs quiet rather than asserting that a process is running", async () => {
    await file(claudePath(home), "{}\n");
    expect((await new SessionMonitor(home).refresh(Date.now() + 60000))[0].activity).toBe("quiet");
  });
});
