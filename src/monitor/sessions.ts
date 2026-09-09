import { basename } from "node:path";
import { record, safeText } from "../core/privacy";
import { ObservedSession } from "../core/types";
import { discoverSessionFiles } from "./files";
import { SessionTailer } from "./tailer";

export class SessionMonitor {
  private tails = new Map<string, SessionTailer>();
  private sessions = new Map<string, ObservedSession>();
  private scanAt = 0;
  constructor(private home: string) {}

  async refresh(now = Date.now()): Promise<ObservedSession[]> {
    if (now - this.scanAt > 10000 || this.scanAt === 0) {
      const files = await discoverSessionFiles(this.home);
      const paths = new Set(files.map((file) => file.path));
      for (const path of this.tails.keys())
        if (!paths.has(path)) {
          this.tails.delete(path);
          this.sessions.delete(path);
        }
      for (const file of files)
        if (!this.tails.has(file.path)) {
          this.tails.set(file.path, new SessionTailer(this.home, file));
          const id = basename(file.path, ".jsonl").match(/[0-9a-f]{8}-[0-9a-f-]{27}$/i)?.[0] ?? "";
          this.sessions.set(file.path, {
            id,
            engine: file.engine,
            cwd: "",
            updatedAt: file.mtime,
            activity: "quiet",
            summary: "Observed session",
            source: "external-log",
          });
        }
      this.scanAt = now;
    }
    for (const [path, tail] of this.tails) {
      const session = this.sessions.get(path)!;
      const exists = await tail.poll((raw) => {
        const event = record(raw);
        const payload = record(event.payload);
        const cwd = safeText(event.cwd, safeText(payload.cwd));
        if (cwd) session.cwd = cwd;
        if (event.type === "session_meta") session.id = safeText(payload.id, session.id);
        if (typeof event.sessionId === "string") session.id = event.sessionId;
        // Only semantic progress: do not extract user prompts or reasoning from transcripts.
        if (event.type === "assistant" || event.type === "progress" || event.type === "user") {
          session.activity = "recent-activity";
          session.summary =
            event.type === "assistant" ? "Assistant response recorded" : "Tool or turn activity recorded";
        }
        if (event.type === "event_msg") {
          if (payload.type === "task_started") {
            session.summary = "Turn started";
            session.activity = "recent-activity";
          }
          if (payload.type === "task_complete" || payload.type === "turn_aborted") {
            session.activity = "completed";
            session.summary = "Turn ended";
          }
          if (payload.type === "agent_message") session.summary = "Assistant response recorded";
        }
        if (event.type === "result") {
          session.activity = "completed";
          session.summary = "Task result recorded";
        }
      });
      session.updatedAt = tail.file.mtime;
      if (!exists) session.activity = "unavailable";
      else if (session.activity !== "completed")
        session.activity = now - session.updatedAt < 30000 ? "recent-activity" : "quiet";
    }
    return [...this.sessions.values()].filter((s) => s.id).sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
