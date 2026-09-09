import { isAbsolute } from "node:path";
import { StartRequest } from "./types";
import { record } from "./privacy";
import { validateSessionId } from "../adapters/commands";

const claudeModes = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
const sandboxes = ["read-only", "workspace-write", "danger-full-access"];

export function validateStart(value: unknown): StartRequest {
  const v = record(value);
  if (v.engine !== "claude" && v.engine !== "codex") throw new Error("Select a supported local CLI");
  if (typeof v.cwd !== "string" || !isAbsolute(v.cwd) || v.cwd.includes("\0"))
    throw new Error("Choose an absolute project directory");
  if (typeof v.prompt !== "string" || !v.prompt.trim() || v.prompt.length > 64000)
    throw new Error("Prompt must contain 1–64000 characters");
  if (typeof v.persistSession !== "boolean" || typeof v.debug !== "boolean") throw new Error("Invalid privacy options");
  if (typeof v.timeoutMs !== "number" || !Number.isInteger(v.timeoutMs) || v.timeoutMs < 100 || v.timeoutMs > 86400000)
    throw new Error("Invalid task timeout");
  if (!claudeModes.includes(String(v.claudePermission)) || !sandboxes.includes(String(v.sandbox)))
    throw new Error("Invalid permission policy");
  if (!["never", "on-request", "untrusted"].includes(String(v.codexApproval)))
    throw new Error("Invalid approval policy");
  for (const field of ["allowedTools", "deniedTools"]) {
    const rules = v[field];
    if (
      !Array.isArray(rules) ||
      rules.length > 64 ||
      rules.some((rule) => typeof rule !== "string" || rule.length > 512 || /[\r\n\0]/.test(rule))
    )
      throw new Error("Invalid tool rules");
  }
  if (
    v.executable !== undefined &&
    (typeof v.executable !== "string" || !isAbsolute(v.executable) || v.executable.includes("\0"))
  )
    throw new Error("Executable path must be absolute");
  if (v.resume !== undefined) {
    if (typeof v.resume !== "string") throw new Error("Invalid session ID");
    validateSessionId(v.resume);
  }
  return v as unknown as StartRequest;
}
