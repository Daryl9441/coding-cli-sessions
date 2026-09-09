import { Capabilities, CliAdapter, ProcessSpec, StartRequest } from "../core/types";
import { parseClaude, parseCodex } from "./parsers";
import { hasFlag } from "./capabilities";

export function validateSessionId(id: string): void {
  if (id !== "last" && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid session ID");
}

function compatible(cap: Capabilities): void {
  if (!cap.compatible) throw new Error("CLI version is incompatible; run Check Coding CLI Setup");
  if (!cap.loggedIn) throw new Error("CLI login is not verified; sign in using the CLI in your terminal");
}

function claude(request: StartRequest, cap: Capabilities): ProcessSpec {
  compatible(cap);
  if (!cap.claudePermissions.includes(request.claudePermission))
    throw new Error("Permission mode is unsupported by this Claude version");
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--permission-mode",
    request.claudePermission,
  ];
  if (!request.persistSession) args.push("--no-session-persistence");
  for (const [flag, rules] of [
    ["--allowedTools", request.allowedTools],
    ["--disallowedTools", request.deniedTools],
  ] as const) {
    if (rules.length) {
      if (!hasFlag(cap.help.main, flag)) throw new Error(`CLI does not support ${flag}`);
      args.push(flag, rules.join(","));
    }
  }
  if (request.resume) {
    validateSessionId(request.resume);
    if (request.resume === "last") args.push("-c");
    else args.push("--resume", request.resume);
  }
  return { executable: cap.executable, args, cwd: request.cwd, input: request.prompt };
}

function codex(request: StartRequest, cap: Capabilities): ProcessSpec {
  compatible(cap);
  if (request.codexApproval !== "never")
    throw new Error("This Codex headless adapter supports never only; interactive approval policies cannot be honored");
  const args = ["exec", "--sandbox", request.sandbox, "--config", 'approval_policy="never"'];
  for (const setting of [
    "analytics.enabled=false",
    "feedback.enabled=false",
    "otel.log_user_prompt=false",
    'otel.exporter="none"',
    'otel.trace_exporter="none"',
    'otel.metrics_exporter="none"',
    'history.persistence="none"',
  ])
    args.push("--config", setting);
  // Exec options precede the nested resume subcommand. No root TUI flags are mixed in.
  if (request.resume) {
    validateSessionId(request.resume);
    args.push("resume");
  }
  args.push("--json");
  if (!request.persistSession) args.push("--ephemeral");
  if (request.resume === "last") args.push("--last");
  else if (request.resume) args.push(request.resume);
  args.push("-");
  return { executable: cap.executable, args, cwd: request.cwd, input: request.prompt };
}

export const claudeAdapter: CliAdapter = {
  engine: "claude",
  buildStart: claude,
  buildHeadlessResume: claude,
  parse: parseClaude,
  buildInteractiveResume(executable, id) {
    validateSessionId(id);
    return { executable, args: id === "last" ? ["-c"] : ["--resume", id] };
  },
};
export const codexAdapter: CliAdapter = {
  engine: "codex",
  buildStart: codex,
  buildHeadlessResume: codex,
  parse: parseCodex,
  buildInteractiveResume(executable, id) {
    validateSessionId(id);
    return { executable, args: id === "last" ? ["resume", "--last"] : ["resume", id] };
  },
};

export const adapters = { claude: claudeAdapter, codex: codexAdapter };
