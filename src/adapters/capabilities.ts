import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { Capabilities, ClaudePermission, Engine } from "../core/types";
import { minimalEnvironment, record, safeText } from "../core/privacy";
import { probe } from "../runtime/process";

export function hasFlag(help: string, flag: string): boolean {
  return help.split(/\s+/).some((token) => token.replace(/[,;]$/, "") === flag);
}

export async function executableCandidates(engine: Engine | "node", explicit?: string): Promise<string[]> {
  if (explicit) {
    if (!isAbsolute(explicit)) throw new Error("Executable must be an absolute path");
    return [explicit];
  }
  const home = homedir();
  const searchPath = minimalEnvironment().PATH ?? "";
  const directories = [
    join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    ...searchPath.split(delimiter),
  ];
  const candidates = directories.filter(isAbsolute).map((dir) => join(dir, engine));
  if (engine === "codex")
    candidates.push(
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
    );
  const result: string[] = [];
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      result.push(candidate);
    } catch {
      /* Not installed here. */
    }
  }
  return result;
}

export function evaluateCapabilities(
  engine: Engine,
  executable: string,
  version: string,
  help: Record<string, string>,
  loggedIn: boolean,
): Capabilities {
  const issues: string[] = [];
  const required =
    engine === "claude"
      ? [
          "--print",
          "--output-format",
          "--include-partial-messages",
          "--verbose",
          "--permission-mode",
          "--resume",
          "--no-session-persistence",
        ]
      : ["--json", "--sandbox", "--ephemeral", "--config"];
  const relevant = engine === "claude" ? help.main : help.exec;
  for (const flag of required) if (!hasFlag(relevant ?? "", flag)) issues.push(`Missing ${flag}`);
  if (engine === "codex" && !hasFlag(help.execResume ?? "", "--json"))
    issues.push("Headless resume JSONL is unavailable");
  const modes: ClaudePermission[] = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
  const permissionLine = (help.main ?? "").split("\n").find((line) => line.includes("--permission-mode")) ?? "";
  return {
    engine,
    executable,
    version,
    loggedIn,
    compatible: issues.length === 0,
    issues,
    help,
    claudePermissions: modes.filter((mode) => permissionLine.includes(`"${mode}"`)),
    // The verified Codex exec implementation forces never for ordinary headless execution.
    codexApprovals: engine === "codex" ? ["never"] : [],
  };
}

export async function inspectCli(engine: Engine, explicit?: string): Promise<Capabilities> {
  const candidates = await executableCandidates(engine, explicit);
  for (const executable of candidates) {
    const main = await probe(executable, ["--help"], homedir());
    if (main.code !== 0) continue;
    const version = await probe(executable, ["--version"], homedir());
    const help: Record<string, string> = { main: main.stdout };
    let loggedIn = false;
    if (engine === "claude") {
      help.agents = (await probe(executable, ["agents", "--help"], homedir())).stdout;
      const authHelp = await probe(executable, ["auth", "status", "--help"], homedir());
      if (authHelp.code === 0 && hasFlag(authHelp.stdout, "--json")) {
        const status = await probe(executable, ["auth", "status", "--json"], homedir());
        try {
          loggedIn = record(JSON.parse(status.stdout)).loggedIn === true;
        } catch {
          /* Invalid status is not verified. */
        }
      }
    } else {
      for (const [key, args] of [
        ["exec", ["exec", "--help"]],
        ["resume", ["resume", "--help"]],
        ["execResume", ["exec", "resume", "--help"]],
      ] as const) {
        help[key] = (await probe(executable, [...args], homedir())).stdout;
      }
      const loginHelp = await probe(executable, ["login", "--help"], homedir());
      if (loginHelp.code === 0 && /\bstatus\b/.test(loginHelp.stdout)) {
        const status = await probe(executable, ["login", "status"], homedir());
        loggedIn = status.code === 0 && /logged in/i.test(status.stdout + status.stderr);
      }
    }
    // Discard authentication payloads: expose only a boolean, never emails or token fragments.
    return evaluateCapabilities(engine, executable, safeText(version.stdout).trim(), help, loggedIn);
  }
  return {
    engine,
    executable: explicit ?? engine,
    version: "Unavailable",
    loggedIn: false,
    compatible: false,
    issues: ["CLI missing or unable to execute --help"],
    help: {},
    claudePermissions: [],
    codexApprovals: [],
  };
}
