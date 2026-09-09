export type Engine = "claude" | "codex";
export const taskStates = [
  "starting",
  "running",
  "stopping",
  "completed",
  "failed",
  "cancelled",
  "timed-out",
  "interrupted",
] as const;
export type TaskState = (typeof taskStates)[number];
export const lifecycleEvents = ["started", "succeeded", "failed", "stop", "stopped", "timeout", "lost"] as const;
export type LifecycleEvent = (typeof lifecycleEvents)[number];
export type ClaudePermission = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";
export type CodexApproval = "never" | "on-request" | "untrusted";
export type Sandbox = "read-only" | "workspace-write" | "danger-full-access";

export interface StartRequest {
  engine: Engine;
  cwd: string;
  prompt: string;
  executable?: string;
  resume?: string;
  persistSession: boolean;
  timeoutMs: number;
  claudePermission: ClaudePermission;
  allowedTools: string[];
  deniedTools: string[];
  codexApproval: CodexApproval;
  sandbox: Sandbox;
  debug: boolean;
}

export interface NormalizedEvent {
  kind: "session" | "started" | "progress" | "tool" | "denied" | "completed" | "failed";
  text: string;
  sessionId?: string;
}

export interface Task {
  id: string;
  engine: Engine;
  cwd: string;
  state: TaskState;
  startedAt: number;
  updatedAt: number;
  sessionId?: string;
  persistSession: boolean;
  policy: string;
  events: { at: number; kind: string; text: string }[];
  exitCode?: number | null;
  signal?: string | null;
}

export interface ObservedSession {
  id: string;
  engine: Engine;
  cwd: string;
  updatedAt: number;
  activity: "recent-activity" | "quiet" | "completed" | "unavailable";
  summary: string;
  source: "external-log";
}

export interface Capabilities {
  engine: Engine;
  executable: string;
  version: string;
  loggedIn: boolean;
  compatible: boolean;
  issues: string[];
  help: Record<string, string>;
  claudePermissions: ClaudePermission[];
  codexApprovals: CodexApproval[];
}

export interface ProcessSpec {
  executable: string;
  args: string[];
  cwd: string;
  input: string;
}
export interface CliAdapter {
  readonly engine: Engine;
  buildStart(request: StartRequest, capabilities: Capabilities): ProcessSpec;
  buildHeadlessResume(request: StartRequest, capabilities: Capabilities): ProcessSpec;
  buildInteractiveResume(executable: string, sessionId: string): { executable: string; args: string[] };
  parse(event: unknown): NormalizedEvent[];
}
