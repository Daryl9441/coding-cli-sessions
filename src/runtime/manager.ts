import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { adapters } from "../adapters/commands";
import { inspectCli } from "../adapters/capabilities";
import { JsonlDecoder } from "../core/jsonl";
import { redact } from "../core/privacy";
import { isTerminal, transition } from "../core/state-machine";
import { Capabilities, Engine, NormalizedEvent, Task } from "../core/types";
import { validateStart } from "../core/validation";
import { DebugLogs } from "./debug";
import { spawnCli, terminateChild } from "./process";

type Inspector = (engine: Engine, explicit?: string) => Promise<Capabilities>;
export class TaskManager {
  private tasks = new Map<string, Task>();
  private children = new Map<string, ChildProcessWithoutNullStreams>();
  private pendingStarts = 0;
  private resuming = new Set<string>();
  constructor(
    private debug: DebugLogs,
    private inspect: Inspector = inspectCli,
    private maxTasks = 8,
  ) {}

  list(): Task[] {
    return structuredClone([...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt));
  }
  get activeCount(): number {
    return this.children.size + this.pendingStarts;
  }

  async start(input: unknown): Promise<Task> {
    const request = validateStart(input);
    const resumeKey = request.resume ? `${request.engine}:${request.cwd}:${request.resume}` : undefined;
    if (this.activeCount >= this.maxTasks) throw new Error("Concurrent task limit reached");
    if (!(await stat(request.cwd)).isDirectory()) throw new Error("Project directory does not exist");
    if (
      request.resume &&
      ((resumeKey && this.resuming.has(resumeKey)) ||
        [...this.tasks.values()].some(
          (task) => !isTerminal(task.state) && task.sessionId === request.resume && task.engine === request.engine,
        ))
    )
      throw new Error("This session already has a managed task running");
    this.pendingStarts++;
    if (resumeKey) this.resuming.add(resumeKey);
    let capabilities: Capabilities;
    try {
      capabilities = await this.inspect(request.engine, request.executable);
    } finally {
      this.pendingStarts--;
      if (resumeKey) this.resuming.delete(resumeKey);
    }
    if (this.activeCount >= this.maxTasks) throw new Error("Concurrent task limit reached");
    const adapter = adapters[request.engine];
    const spec = request.resume
      ? adapter.buildHeadlessResume(request, capabilities)
      : adapter.buildStart(request, capabilities);
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      engine: request.engine,
      cwd: request.cwd,
      state: "starting",
      startedAt: now,
      updatedAt: now,
      persistSession: request.persistSession,
      policy: request.engine === "claude" ? request.claudePermission : `${request.codexApproval} · ${request.sandbox}`,
      events: [],
      sessionId: request.resume === "last" ? undefined : request.resume,
    };
    this.tasks.set(task.id, task);
    this.prune();
    const child = spawnCli(spec.executable, spec.args, spec.cwd);
    this.children.set(task.id, child);
    if (resumeKey) this.resuming.add(resumeKey);
    let completed = false;
    let failed = false;
    const emit = (event: NormalizedEvent) => {
      task.updatedAt = Date.now();
      if (event.kind === "session" && event.sessionId) task.sessionId = event.sessionId;
      if (event.kind === "completed") completed = true;
      if (event.kind === "failed") failed = true;
      if (event.kind === "started" || event.kind === "session") task.state = transition(task.state, "started");
      const safe = redact(event.text);
      const previous = task.events[task.events.length - 1];
      if (event.kind === "progress" && previous?.kind === "progress") {
        previous.text = redact(previous.text + safe).slice(-8000);
        previous.at = task.updatedAt;
      } else task.events.push({ at: task.updatedAt, kind: event.kind, text: safe });
      if (task.events.length > 200) task.events.shift();
      // Bound the entire snapshot, not only individual events, so IPC remains usable.
      let characters = task.events.reduce((total, item) => total + item.text.length, 0);
      while (characters > 16000 && task.events.length > 1) characters -= task.events.shift()!.text.length;
      if (request.debug) void this.debug.write(task.id, { kind: event.kind, state: task.state }).catch(() => undefined);
    };
    const decoder = new JsonlDecoder(
      (value) => {
        for (const event of adapter.parse(value)) emit(event);
      },
      () => {
        emit({ kind: "progress", text: "[Malformed or oversized CLI event skipped]" });
      },
    );
    child.stdout.on("data", (data: Buffer) => decoder.push(data));
    // stderr may contain prompts or secrets; drain but never retain it.
    child.stderr.on("data", () => undefined);
    child.stdin.on("error", () => undefined);
    const timeout = setTimeout(() => {
      task.state = transition(task.state, "timeout");
      terminateChild(child);
    }, request.timeoutMs);
    child.once("spawn", () => {
      task.state = transition(task.state, "started");
    });
    child.once("error", () => {
      failed = true;
      task.state = transition(task.state, "failed");
      emit({ kind: "failed", text: "Unable to start CLI process" });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      decoder.end();
      task.exitCode = code;
      task.signal = signal;
      task.updatedAt = Date.now();
      if (task.state === "stopping") task.state = transition(task.state, "stopped");
      else if (signal) task.state = transition(task.state, "lost");
      else if (code === 0 && completed && !failed) task.state = transition(task.state, "succeeded");
      else task.state = transition(task.state, "failed");
      this.children.delete(task.id);
      if (resumeKey) this.resuming.delete(resumeKey);
      if (request.debug)
        void this.debug.write(task.id, { kind: "process-closed", state: task.state, code }).catch(() => undefined);
    });
    child.stdin.end(spec.input);
    return structuredClone(task);
  }

  stop(id: string): void {
    const child = this.children.get(id);
    const task = this.tasks.get(id);
    if (!child || !task || isTerminal(task.state)) throw new Error("Only a live managed task can be stopped");
    task.state = transition(task.state, "stop");
    task.updatedAt = Date.now();
    terminateChild(child);
  }

  forget(id: string): void {
    const task = this.tasks.get(id);
    if (task && !isTerminal(task.state)) throw new Error("Stop this task before clearing its results");
    this.tasks.delete(id);
  }

  shutdown(): void {
    for (const id of this.children.keys()) {
      try {
        this.stop(id);
      } catch {
        /* Already closing. */
      }
    }
  }
  private prune(): void {
    if (this.tasks.size <= 100) return;
    for (const [id, task] of this.tasks) {
      if (isTerminal(task.state)) this.tasks.delete(id);
      if (this.tasks.size <= 100) break;
    }
  }
}
