"use strict";

// src/runtime/server.ts
var import_node_net2 = require("node:net");
var import_promises6 = require("node:fs/promises");
var import_node_path7 = require("node:path");
var import_node_os3 = require("node:os");

// src/adapters/capabilities.ts
var import_promises = require("node:fs/promises");
var import_node_os = require("node:os");
var import_node_path = require("node:path");

// src/core/privacy.ts
var secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s"',}]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
];
function redact(text) {
  let result = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const pattern of secretPatterns) result = result.replace(pattern, "[REDACTED]");
  return result;
}
function safeText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return redact(value).slice(0, 4e3);
}
function record(value) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  return {};
}
function array(value) {
  return Array.isArray(value) ? value : [];
}
var environmentKeys = ["HOME", "PATH", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];
function minimalEnvironment(source = process.env) {
  const result = {};
  for (const key of environmentKeys) {
    const value = source[key];
    if (value !== void 0) result[key] = value;
  }
  result.DO_NOT_TRACK = "1";
  result.DISABLE_TELEMETRY = "1";
  result.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return result;
}

// src/runtime/process.ts
var import_node_child_process = require("node:child_process");
function spawnCli(executable, args, cwd) {
  if (args.some((arg) => arg.includes("\0")) || executable.includes("\0")) throw new Error("Invalid process argument");
  return (0, import_node_child_process.spawn)(executable, args, {
    cwd,
    env: minimalEnvironment(),
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
}
function terminateChild(child, graceMs = 1200) {
  const signal = (name) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid, name);
    } catch {
      child.kill(name);
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => {
    signal("SIGKILL");
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  }, graceMs);
  timer.unref();
  child.once("close", () => clearTimeout(timer));
}
async function probe(executable, args, cwd, timeoutMs = 1e4) {
  return new Promise((resolve2) => {
    let child;
    try {
      child = spawnCli(executable, args, cwd);
    } catch {
      resolve2({ code: -1, stdout: "", stderr: "", timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (data) => {
      stdout = (stdout + data.toString("utf8")).slice(-256e3);
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + data.toString("utf8")).slice(-256e3);
    });
    child.stdin.on("error", () => void 0);
    child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve2({ code: -1, stdout: "", stderr: "", timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve2({ code, stdout, stderr, timedOut });
    });
  });
}

// src/adapters/capabilities.ts
function hasFlag(help, flag) {
  return help.split(/\s+/).some((token) => token.replace(/[,;]$/, "") === flag);
}
async function executableCandidates(engine, explicit) {
  if (explicit) {
    if (!(0, import_node_path.isAbsolute)(explicit)) throw new Error("Executable must be an absolute path");
    return [explicit];
  }
  const home = (0, import_node_os.homedir)();
  const searchPath = minimalEnvironment().PATH ?? "";
  const directories = [
    (0, import_node_path.join)(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    ...searchPath.split(import_node_path.delimiter)
  ];
  const candidates = directories.filter(import_node_path.isAbsolute).map((dir) => (0, import_node_path.join)(dir, engine));
  if (engine === "codex")
    candidates.push(
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex"
    );
  const result = [];
  for (const candidate of new Set(candidates)) {
    try {
      await (0, import_promises.access)(candidate, import_promises.constants.X_OK);
      result.push(candidate);
    } catch {
    }
  }
  return result;
}
function evaluateCapabilities(engine, executable, version, help, loggedIn) {
  const issues = [];
  const required = engine === "claude" ? [
    "--print",
    "--output-format",
    "--include-partial-messages",
    "--verbose",
    "--permission-mode",
    "--resume",
    "--no-session-persistence"
  ] : ["--json", "--sandbox", "--ephemeral", "--config"];
  const relevant = engine === "claude" ? help.main : help.exec;
  for (const flag of required) if (!hasFlag(relevant ?? "", flag)) issues.push(`Missing ${flag}`);
  if (engine === "codex" && !hasFlag(help.execResume ?? "", "--json"))
    issues.push("Headless resume JSONL is unavailable");
  const modes = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
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
    codexApprovals: engine === "codex" ? ["never"] : []
  };
}
async function inspectCli(engine, explicit) {
  const candidates = await executableCandidates(engine, explicit);
  for (const executable of candidates) {
    const main = await probe(executable, ["--help"], (0, import_node_os.homedir)());
    if (main.code !== 0) continue;
    const version = await probe(executable, ["--version"], (0, import_node_os.homedir)());
    const help = { main: main.stdout };
    let loggedIn = false;
    if (engine === "claude") {
      help.agents = (await probe(executable, ["agents", "--help"], (0, import_node_os.homedir)())).stdout;
      const authHelp = await probe(executable, ["auth", "status", "--help"], (0, import_node_os.homedir)());
      if (authHelp.code === 0 && hasFlag(authHelp.stdout, "--json")) {
        const status = await probe(executable, ["auth", "status", "--json"], (0, import_node_os.homedir)());
        try {
          loggedIn = record(JSON.parse(status.stdout)).loggedIn === true;
        } catch {
        }
      }
    } else {
      for (const [key, args] of [
        ["exec", ["exec", "--help"]],
        ["resume", ["resume", "--help"]],
        ["execResume", ["exec", "resume", "--help"]]
      ]) {
        help[key] = (await probe(executable, [...args], (0, import_node_os.homedir)())).stdout;
      }
      const loginHelp = await probe(executable, ["login", "--help"], (0, import_node_os.homedir)());
      if (loginHelp.code === 0 && /\bstatus\b/.test(loginHelp.stdout)) {
        const status = await probe(executable, ["login", "status"], (0, import_node_os.homedir)());
        loggedIn = status.code === 0 && /logged in/i.test(status.stdout + status.stderr);
      }
    }
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
    codexApprovals: []
  };
}

// src/monitor/sessions.ts
var import_node_path3 = require("node:path");

// src/monitor/files.ts
var import_node_fs = require("node:fs");
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");
var uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
var claudeName = new RegExp(`^${uuid}\\.jsonl$`, "i");
var codexName = new RegExp(`^(?:rollout-[0-9T:.Z_-]+-)?${uuid}\\.jsonl$`, "i");
function sessionRoot(home, engine) {
  return engine === "claude" ? (0, import_node_path2.join)(home, ".claude", "projects") : (0, import_node_path2.join)(home, ".codex", "sessions");
}
function allowedSessionPath(home, engine, path) {
  const inside = (0, import_node_path2.relative)(sessionRoot(home, engine), (0, import_node_path2.resolve)(path));
  const parts = inside.split(import_node_path2.sep);
  if (inside.startsWith("..") || inside === "" || parts.some((part) => /(?:auth|credential|token|secret)/i.test(part)))
    return false;
  if (engine === "claude") return parts.length === 2 && claudeName.test(parts[1]);
  return parts.length <= 5 && codexName.test(parts[parts.length - 1]);
}
async function openSession(home, engine, path) {
  if (!allowedSessionPath(home, engine, path)) throw new Error("Not an allowed session transcript");
  let parent = (0, import_node_path2.resolve)(home);
  const relativePath = (0, import_node_path2.relative)(parent, (0, import_node_path2.resolve)(path));
  for (const part of relativePath.split(import_node_path2.sep)) {
    parent = (0, import_node_path2.join)(parent, part);
    const stat2 = await (0, import_promises2.lstat)(parent);
    if (stat2.isSymbolicLink()) throw new Error("Session symlinks are not followed");
  }
  const handle = await (0, import_promises2.open)(path, import_node_fs.constants.O_RDONLY | import_node_fs.constants.O_NOFOLLOW);
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new Error("Session must be a regular file");
  }
  return handle;
}
async function discoverSessionFiles(home, limit = 120) {
  const files = [];
  let budget = 5e3;
  async function visit(path, engine, depth) {
    if (depth > 4 || budget <= 0) return;
    let entries;
    try {
      if ((await (0, import_promises2.lstat)(path)).isSymbolicLink()) return;
      entries = await (0, import_promises2.readdir)(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (--budget < 0) return;
      if (entry.isSymbolicLink()) continue;
      const target = (0, import_node_path2.join)(path, entry.name);
      if (entry.isDirectory()) {
        if (engine === "codex" || depth === 0) await visit(target, engine, depth + 1);
      } else if (entry.isFile() && allowedSessionPath(home, engine, target)) {
        try {
          const stat2 = await (0, import_promises2.lstat)(target);
          files.push({ path: target, engine, mtime: stat2.mtimeMs });
        } catch {
        }
      }
    }
  }
  for (const engine of ["claude", "codex"]) {
    budget = 5e3;
    await visit(sessionRoot(home, engine), engine, 0);
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

// src/monitor/tailer.ts
var import_node_string_decoder = require("node:string_decoder");
var SessionTailer = class {
  constructor(home, file, maxBytes = 512e3) {
    this.home = home;
    this.file = file;
    this.maxBytes = maxBytes;
  }
  home;
  file;
  maxBytes;
  offset = 0;
  inode = -1;
  birthtime = -1;
  pending = "";
  decoder = new import_node_string_decoder.StringDecoder("utf8");
  async poll(onValue) {
    let handle;
    try {
      handle = await openSession(this.home, this.file.engine, this.file.path);
      const stat2 = await handle.stat();
      if (stat2.ino !== this.inode || stat2.birthtimeMs !== this.birthtime || stat2.size < this.offset) {
        this.offset = 0;
        this.pending = "";
        this.decoder = new import_node_string_decoder.StringDecoder("utf8");
        this.inode = stat2.ino;
        this.birthtime = stat2.birthtimeMs;
      }
      let skipFragment = false;
      if (stat2.size - this.offset > this.maxBytes) {
        if (this.offset === 0) {
          const head = Buffer.alloc(16e3);
          const { bytesRead: bytesRead2 } = await handle.read(head, 0, head.length, 0);
          this.consume(head.subarray(0, bytesRead2), onValue);
        }
        this.offset = stat2.size - this.maxBytes;
        this.pending = "";
        this.decoder = new import_node_string_decoder.StringDecoder("utf8");
        skipFragment = true;
      }
      const buffer = Buffer.alloc(Math.min(this.maxBytes, stat2.size - this.offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
      this.offset += bytesRead;
      let chunk = buffer.subarray(0, bytesRead);
      if (skipFragment) {
        const newline = chunk.indexOf(10);
        chunk = newline >= 0 ? chunk.subarray(newline + 1) : Buffer.alloc(0);
      }
      this.consume(chunk, onValue);
      this.file.mtime = stat2.mtimeMs;
      return true;
    } catch {
      this.inode = -1;
      this.birthtime = -1;
      this.offset = 0;
      this.pending = "";
      this.decoder = new import_node_string_decoder.StringDecoder("utf8");
      return false;
    } finally {
      await handle?.close();
    }
  }
  consume(buffer, onValue) {
    this.pending += this.decoder.write(buffer);
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    if (this.pending.length > this.maxBytes) this.pending = "";
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      onValue(parsed);
    }
  }
};

// src/monitor/sessions.ts
var SessionMonitor = class {
  constructor(home) {
    this.home = home;
  }
  home;
  tails = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Map();
  scanAt = 0;
  async refresh(now = Date.now()) {
    if (now - this.scanAt > 1e4 || this.scanAt === 0) {
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
          const id = (0, import_node_path3.basename)(file.path, ".jsonl").match(/[0-9a-f]{8}-[0-9a-f-]{27}$/i)?.[0] ?? "";
          this.sessions.set(file.path, {
            id,
            engine: file.engine,
            cwd: "",
            updatedAt: file.mtime,
            activity: "quiet",
            summary: "Observed session",
            source: "external-log"
          });
        }
      this.scanAt = now;
    }
    for (const [path, tail] of this.tails) {
      const session = this.sessions.get(path);
      const exists = await tail.poll((raw) => {
        const event = record(raw);
        const payload = record(event.payload);
        const cwd = safeText(event.cwd, safeText(payload.cwd));
        if (cwd) session.cwd = cwd;
        if (event.type === "session_meta") session.id = safeText(payload.id, session.id);
        if (typeof event.sessionId === "string") session.id = event.sessionId;
        if (event.type === "assistant" || event.type === "progress" || event.type === "user") {
          session.activity = "recent-activity";
          session.summary = event.type === "assistant" ? "Assistant response recorded" : "Tool or turn activity recorded";
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
        session.activity = now - session.updatedAt < 3e4 ? "recent-activity" : "quiet";
    }
    return [...this.sessions.values()].filter((s) => s.id).sort((a, b) => b.updatedAt - a.updatedAt);
  }
};

// src/runtime/debug.ts
var import_node_fs2 = require("node:fs");
var import_promises4 = require("node:fs/promises");
var import_node_path5 = require("node:path");

// src/runtime/paths.ts
var import_promises3 = require("node:fs/promises");
var import_node_os2 = require("node:os");
var import_node_path4 = require("node:path");
function runtimeDirectory() {
  const suffix = `ccs-${process.getuid?.() ?? "local"}`;
  const preferred = (0, import_node_path4.join)((0, import_node_os2.tmpdir)(), suffix);
  return preferred.length < 80 ? preferred : (0, import_node_path4.join)("/tmp", suffix);
}
function socketPath() {
  return (0, import_node_path4.join)(runtimeDirectory(), "supervisor.sock");
}
async function secureDirectory(directory) {
  await (0, import_promises3.mkdir)(directory, { recursive: true, mode: 448 });
  const info = await (0, import_promises3.lstat)(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || process.getuid && info.uid !== process.getuid())
    throw new Error("Unsafe runtime directory");
  await (0, import_promises3.chmod)(directory, 448);
}

// src/runtime/debug.ts
var DebugLogs = class {
  constructor(directory) {
    this.directory = directory;
  }
  directory;
  async write(id, metadata) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid debug ID");
    await secureDirectory(this.directory);
    const line = redact(JSON.stringify({ at: Date.now(), kind: metadata.kind, state: metadata.state, code: metadata.code })) + "\n";
    await (0, import_promises4.appendFile)((0, import_node_path5.join)(this.directory, `debug-${id}.jsonl`), line, {
      mode: 384,
      flag: import_node_fs2.constants.O_WRONLY | import_node_fs2.constants.O_CREAT | import_node_fs2.constants.O_APPEND | import_node_fs2.constants.O_NOFOLLOW
    });
  }
  async clear() {
    let count = 0;
    try {
      if ((await (0, import_promises4.lstat)(this.directory)).isSymbolicLink()) throw new Error("Invalid debug directory");
      for (const name of await (0, import_promises4.readdir)(this.directory)) {
        if (/^debug-[0-9a-f-]{36}\.jsonl$/i.test(name)) {
          await (0, import_promises4.unlink)((0, import_node_path5.join)(this.directory, name));
          count++;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return count;
  }
};

// src/runtime/manager.ts
var import_node_crypto = require("node:crypto");
var import_promises5 = require("node:fs/promises");

// src/adapters/parsers.ts
function claudeBlock(raw) {
  const block = record(raw);
  switch (block.type) {
    case "text":
      return [{ kind: "progress", text: safeText(block.text) }];
    case "tool_use":
      return [{ kind: "tool", text: safeText(block.name, "Tool call") }];
    default:
      return [];
  }
}
function parseClaude(raw) {
  const event = record(raw);
  switch (event.type) {
    case "init":
      return [{ kind: "session", sessionId: safeText(event.session_id), text: "Session initialized" }];
    case "system":
      switch (event.subtype) {
        case "init":
          return [{ kind: "session", sessionId: safeText(event.session_id), text: "Session initialized" }];
        case "permission_denied":
          return [{ kind: "denied", text: "A tool was denied by the configured policy" }];
        default:
          return [];
      }
    case "assistant":
      return array(record(event.message).content).flatMap(claudeBlock);
    case "stream_event": {
      const nested = record(event.event);
      switch (nested.type) {
        case "message_start":
          return [{ kind: "started", text: "Generating response" }];
        case "content_block_start":
          return claudeBlock(nested.content_block);
        case "content_block_delta": {
          const delta = record(nested.delta);
          switch (delta.type) {
            case "text_delta":
              return [{ kind: "progress", text: safeText(delta.text) }];
            default:
              return [];
          }
        }
        default:
          return [];
      }
    }
    case "result": {
      const denials = array(event.permission_denials).map(() => ({
        kind: "denied",
        text: "Tool permission denied"
      }));
      if (event.is_error === true)
        return [...denials, { kind: "failed", text: "Claude reported an unsuccessful result" }];
      return [...denials, { kind: "completed", text: safeText(event.result, "Task completed") }];
    }
    default:
      return [];
  }
}
function codexItem(raw) {
  const item = record(raw);
  switch (item.type) {
    case "agent_message":
      return [{ kind: "progress", text: safeText(item.text) }];
    case "command_execution":
      return [{ kind: "tool", text: "Command execution" }];
    case "file_change":
      return [{ kind: "tool", text: "File changes" }];
    case "mcp_tool_call":
      return [{ kind: "tool", text: "MCP tool call" }];
    case "web_search":
      return [{ kind: "tool", text: "Web search" }];
    default:
      return [];
  }
}
function parseCodex(raw) {
  const event = record(raw);
  switch (event.type) {
    case "thread.started":
      return [{ kind: "session", sessionId: safeText(event.thread_id), text: "Thread initialized" }];
    case "turn.started":
      return [{ kind: "started", text: "Turn started" }];
    case "turn.completed":
      return [{ kind: "completed", text: "Turn completed" }];
    case "turn.failed":
      return [{ kind: "failed", text: safeText(record(event.error).message, "Turn failed") }];
    case "error":
      return [{ kind: "failed", text: safeText(event.message, "Codex reported an error") }];
    case "item.started":
    case "item.updated":
    case "item.completed":
      return codexItem(event.item);
    default:
      return [];
  }
}

// src/adapters/commands.ts
function validateSessionId(id) {
  if (id !== "last" && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid session ID");
}
function compatible(cap) {
  if (!cap.compatible) throw new Error("CLI version is incompatible; run Check Coding CLI Setup");
  if (!cap.loggedIn) throw new Error("CLI login is not verified; sign in using the CLI in your terminal");
}
function claude(request, cap) {
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
    request.claudePermission
  ];
  if (!request.persistSession) args.push("--no-session-persistence");
  for (const [flag, rules] of [
    ["--allowedTools", request.allowedTools],
    ["--disallowedTools", request.deniedTools]
  ]) {
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
function codex(request, cap) {
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
    'history.persistence="none"'
  ])
    args.push("--config", setting);
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
var claudeAdapter = {
  engine: "claude",
  buildStart: claude,
  buildHeadlessResume: claude,
  parse: parseClaude,
  buildInteractiveResume(executable, id) {
    validateSessionId(id);
    return { executable, args: id === "last" ? ["-c"] : ["--resume", id] };
  }
};
var codexAdapter = {
  engine: "codex",
  buildStart: codex,
  buildHeadlessResume: codex,
  parse: parseCodex,
  buildInteractiveResume(executable, id) {
    validateSessionId(id);
    return { executable, args: id === "last" ? ["resume", "--last"] : ["resume", id] };
  }
};
var adapters = { claude: claudeAdapter, codex: codexAdapter };

// src/core/jsonl.ts
var import_node_string_decoder2 = require("node:string_decoder");
var JsonlDecoder = class {
  constructor(onValue, onInvalid, maxLength = 1024 * 1024) {
    this.onValue = onValue;
    this.onInvalid = onInvalid;
    this.maxLength = maxLength;
  }
  onValue;
  onInvalid;
  maxLength;
  decoder = new import_node_string_decoder2.StringDecoder("utf8");
  pending = "";
  dropping = false;
  push(chunk) {
    const text = this.decoder.write(chunk);
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.dropping) this.pending += part;
      if (this.pending.length > this.maxLength) {
        this.pending = "";
        this.dropping = true;
        this.onInvalid();
      }
      if (part.endsWith("\n")) {
        if (!this.dropping) this.parse(this.pending);
        this.pending = "";
        this.dropping = false;
      }
    }
  }
  end() {
    this.pending += this.decoder.end();
    if (!this.dropping) this.parse(this.pending);
    this.pending = "";
    this.dropping = false;
  }
  parse(line) {
    if (!line.trim()) return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      this.onInvalid();
      return;
    }
    this.onValue(value);
  }
};

// src/core/state-machine.ts
var transitions = {
  starting: {
    started: "running",
    succeeded: "completed",
    failed: "failed",
    stop: "stopping",
    timeout: "timed-out",
    lost: "interrupted"
  },
  running: { succeeded: "completed", failed: "failed", stop: "stopping", timeout: "timed-out", lost: "interrupted" },
  stopping: {
    stopped: "cancelled",
    succeeded: "cancelled",
    failed: "cancelled",
    lost: "cancelled",
    timeout: "timed-out"
  },
  completed: {},
  failed: {},
  cancelled: {},
  "timed-out": {},
  interrupted: {}
};
function transition(state, event) {
  return transitions[state][event] ?? state;
}
function isTerminal(state) {
  return state !== "starting" && state !== "running" && state !== "stopping";
}

// src/core/validation.ts
var import_node_path6 = require("node:path");
var claudeModes = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
var sandboxes = ["read-only", "workspace-write", "danger-full-access"];
function validateStart(value) {
  const v = record(value);
  if (v.engine !== "claude" && v.engine !== "codex") throw new Error("Select a supported local CLI");
  if (typeof v.cwd !== "string" || !(0, import_node_path6.isAbsolute)(v.cwd) || v.cwd.includes("\0"))
    throw new Error("Choose an absolute project directory");
  if (typeof v.prompt !== "string" || !v.prompt.trim() || v.prompt.length > 64e3)
    throw new Error("Prompt must contain 1\u201364000 characters");
  if (typeof v.persistSession !== "boolean" || typeof v.debug !== "boolean") throw new Error("Invalid privacy options");
  if (typeof v.timeoutMs !== "number" || !Number.isInteger(v.timeoutMs) || v.timeoutMs < 100 || v.timeoutMs > 864e5)
    throw new Error("Invalid task timeout");
  if (!claudeModes.includes(String(v.claudePermission)) || !sandboxes.includes(String(v.sandbox)))
    throw new Error("Invalid permission policy");
  if (!["never", "on-request", "untrusted"].includes(String(v.codexApproval)))
    throw new Error("Invalid approval policy");
  for (const field of ["allowedTools", "deniedTools"]) {
    const rules = v[field];
    if (!Array.isArray(rules) || rules.length > 64 || rules.some((rule) => typeof rule !== "string" || rule.length > 512 || /[\r\n\0]/.test(rule)))
      throw new Error("Invalid tool rules");
  }
  if (v.executable !== void 0 && (typeof v.executable !== "string" || !(0, import_node_path6.isAbsolute)(v.executable) || v.executable.includes("\0")))
    throw new Error("Executable path must be absolute");
  if (v.resume !== void 0) {
    if (typeof v.resume !== "string") throw new Error("Invalid session ID");
    validateSessionId(v.resume);
  }
  return v;
}

// src/runtime/manager.ts
var TaskManager = class {
  constructor(debug, inspect = inspectCli, maxTasks = 8) {
    this.debug = debug;
    this.inspect = inspect;
    this.maxTasks = maxTasks;
  }
  debug;
  inspect;
  maxTasks;
  tasks = /* @__PURE__ */ new Map();
  children = /* @__PURE__ */ new Map();
  pendingStarts = 0;
  resuming = /* @__PURE__ */ new Set();
  list() {
    return structuredClone([...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt));
  }
  get activeCount() {
    return this.children.size + this.pendingStarts;
  }
  async start(input) {
    const request = validateStart(input);
    const resumeKey = request.resume ? `${request.engine}:${request.cwd}:${request.resume}` : void 0;
    if (this.activeCount >= this.maxTasks) throw new Error("Concurrent task limit reached");
    if (!(await (0, import_promises5.stat)(request.cwd)).isDirectory()) throw new Error("Project directory does not exist");
    if (request.resume && (resumeKey && this.resuming.has(resumeKey) || [...this.tasks.values()].some(
      (task2) => !isTerminal(task2.state) && task2.sessionId === request.resume && task2.engine === request.engine
    )))
      throw new Error("This session already has a managed task running");
    this.pendingStarts++;
    if (resumeKey) this.resuming.add(resumeKey);
    let capabilities;
    try {
      capabilities = await this.inspect(request.engine, request.executable);
    } finally {
      this.pendingStarts--;
      if (resumeKey) this.resuming.delete(resumeKey);
    }
    if (this.activeCount >= this.maxTasks) throw new Error("Concurrent task limit reached");
    const adapter = adapters[request.engine];
    const spec = request.resume ? adapter.buildHeadlessResume(request, capabilities) : adapter.buildStart(request, capabilities);
    const now = Date.now();
    const task = {
      id: (0, import_node_crypto.randomUUID)(),
      engine: request.engine,
      cwd: request.cwd,
      state: "starting",
      startedAt: now,
      updatedAt: now,
      persistSession: request.persistSession,
      policy: request.engine === "claude" ? request.claudePermission : `${request.codexApproval} \xB7 ${request.sandbox}`,
      events: [],
      sessionId: request.resume === "last" ? void 0 : request.resume
    };
    this.tasks.set(task.id, task);
    this.prune();
    const child = spawnCli(spec.executable, spec.args, spec.cwd);
    this.children.set(task.id, child);
    if (resumeKey) this.resuming.add(resumeKey);
    let completed = false;
    let failed = false;
    const emit = (event) => {
      task.updatedAt = Date.now();
      if (event.kind === "session" && event.sessionId) task.sessionId = event.sessionId;
      if (event.kind === "completed") completed = true;
      if (event.kind === "failed") failed = true;
      if (event.kind === "started" || event.kind === "session") task.state = transition(task.state, "started");
      const safe = redact(event.text);
      const previous = task.events[task.events.length - 1];
      if (event.kind === "progress" && previous?.kind === "progress") {
        previous.text = redact(previous.text + safe).slice(-8e3);
        previous.at = task.updatedAt;
      } else task.events.push({ at: task.updatedAt, kind: event.kind, text: safe });
      if (task.events.length > 200) task.events.shift();
      let characters = task.events.reduce((total, item) => total + item.text.length, 0);
      while (characters > 16e3 && task.events.length > 1) characters -= task.events.shift().text.length;
      if (request.debug) void this.debug.write(task.id, { kind: event.kind, state: task.state }).catch(() => void 0);
    };
    const decoder = new JsonlDecoder(
      (value) => {
        for (const event of adapter.parse(value)) emit(event);
      },
      () => {
        emit({ kind: "progress", text: "[Malformed or oversized CLI event skipped]" });
      }
    );
    child.stdout.on("data", (data) => decoder.push(data));
    child.stderr.on("data", () => void 0);
    child.stdin.on("error", () => void 0);
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
        void this.debug.write(task.id, { kind: "process-closed", state: task.state, code }).catch(() => void 0);
    });
    child.stdin.end(spec.input);
    return structuredClone(task);
  }
  stop(id) {
    const child = this.children.get(id);
    const task = this.tasks.get(id);
    if (!child || !task || isTerminal(task.state)) throw new Error("Only a live managed task can be stopped");
    task.state = transition(task.state, "stop");
    task.updatedAt = Date.now();
    terminateChild(child);
  }
  forget(id) {
    const task = this.tasks.get(id);
    if (task && !isTerminal(task.state)) throw new Error("Stop this task before clearing its results");
    this.tasks.delete(id);
  }
  shutdown() {
    for (const id of this.children.keys()) {
      try {
        this.stop(id);
      } catch {
      }
    }
  }
  prune() {
    if (this.tasks.size <= 100) return;
    for (const [id, task] of this.tasks) {
      if (isTerminal(task.state)) this.tasks.delete(id);
      if (this.tasks.size <= 100) break;
    }
  }
};

// src/runtime/ipc.ts
var import_node_net = require("node:net");
var import_node_string_decoder3 = require("node:string_decoder");
function rpc(path, method, payload, timeoutMs = 15e3) {
  return new Promise((resolve2, reject) => {
    const socket = (0, import_node_net.createConnection)(path);
    let buffer = "";
    const decoder = new import_node_string_decoder3.StringDecoder("utf8");
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Local supervisor did not respond in time"));
    }, timeoutMs);
    socket.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Local supervisor unavailable"));
    });
    socket.on("connect", () => socket.write(JSON.stringify({ method, payload }) + "\n"));
    socket.on("data", (chunk) => {
      buffer += decoder.write(chunk);
      if (buffer.length > 8 * 1024 * 1024) {
        socket.destroy();
        clearTimeout(timer);
        reject(new Error("Supervisor response too large"));
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      socket.destroy();
      try {
        const response = record(JSON.parse(buffer.slice(0, end)));
        if (response.ok !== true)
          reject(new Error(typeof response.error === "string" ? response.error : "Supervisor request failed"));
        else resolve2(response.data);
      } catch {
        reject(new Error("Invalid supervisor response"));
      }
    });
  });
}

// src/runtime/server.ts
var import_node_string_decoder4 = require("node:string_decoder");
async function startServer(path, options = {}) {
  await secureDirectory((0, import_node_path7.dirname)(path));
  try {
    const existing = await (0, import_promises6.lstat)(path);
    if (!existing.isSocket() || process.getuid && existing.uid !== process.getuid())
      throw new Error("Unsafe socket path");
    let live = false;
    try {
      await rpc(path, "ping", void 0, 1e3);
      live = true;
    } catch {
    }
    if (live) throw new Error("Supervisor already running");
    await (0, import_promises6.unlink)(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const logs = new DebugLogs((0, import_node_path7.join)((0, import_node_path7.dirname)(path), "debug"));
  const manager = options.manager ?? new TaskManager(logs);
  const monitor = new SessionMonitor(options.home ?? (0, import_node_os3.homedir)());
  let refresh;
  let lastRequest = Date.now();
  const dispatch = async (method, payload) => {
    const data = record(payload);
    switch (method) {
      case "ping":
        return { protocol: 1 };
      case "list": {
        refresh ??= monitor.refresh().finally(() => {
          refresh = void 0;
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
        const cap = await inspectCli(data.engine, typeof data.executable === "string" ? data.executable : void 0);
        return { ...cap, help: {} };
      }
      default:
        throw new Error("Unsupported local request");
    }
  };
  const server = (0, import_node_net2.createServer)((socket) => {
    let buffer = "";
    const decoder = new import_node_string_decoder4.StringDecoder("utf8");
    let handled = false;
    socket.setTimeout(12e4, () => socket.destroy());
    socket.on("error", () => void 0);
    socket.on("data", (chunk) => {
      if (handled) return;
      buffer += decoder.write(chunk);
      if (buffer.length > 1e5) {
        socket.destroy();
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      handled = true;
      lastRequest = Date.now();
      let input;
      try {
        input = record(JSON.parse(buffer.slice(0, end)));
      } catch {
        socket.end(JSON.stringify({ ok: false, error: "Invalid request" }) + "\n");
        return;
      }
      buffer = "";
      void dispatch(input.method, input.payload).then(
        (data) => socket.end(JSON.stringify({ ok: true, data }) + "\n"),
        (error) => socket.end(
          JSON.stringify({ ok: false, error: safeText(error instanceof Error ? error.message : "Request failed") }) + "\n"
        )
      );
    });
  });
  await new Promise((resolve2, reject) => {
    server.once("error", reject);
    server.listen(path, resolve2);
  });
  await (0, import_promises6.chmod)(path, 384);
  const close = async () => {
    clearInterval(idle);
    manager.shutdown();
    await new Promise((resolve2) => server.close(() => resolve2()));
    try {
      await (0, import_promises6.unlink)(path);
    } catch {
    }
  };
  const idle = setInterval(() => {
    if (manager.activeCount === 0 && Date.now() - lastRequest > (options.idleMs ?? 3e5)) void close();
  }, 1e3);
  idle.unref();
  return { server, manager, close };
}

// src/runtime/entry.ts
var passed = process.argv[process.argv.indexOf("--socket") + 1];
if (passed !== socketPath()) process.exitCode = 1;
else {
  void startServer(passed).then(({ close }) => {
    process.once("SIGTERM", () => {
      void close();
    });
    process.once("SIGINT", () => {
      void close();
    });
  }).catch(() => {
    process.exitCode = 1;
  });
}
