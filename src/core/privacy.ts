const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s"',}]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

export function redact(text: string): string {
  // eslint-disable-next-line no-control-regex -- Strip terminal escape sequences from untrusted CLI output.
  let result = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const pattern of secretPatterns) result = result.replace(pattern, "[REDACTED]");
  return result;
}

export function safeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return redact(value).slice(0, 4000);
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Untrusted output must not become Markdown images/links with background network requests. */
export function fencedText(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}\n${redact(value)}\n${fence}`;
}

// Only this function may read process.env. Authentication remains inside each installed CLI.
const environmentKeys = ["HOME", "PATH", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] as const;
export function minimalEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of environmentKeys) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  result.DO_NOT_TRACK = "1";
  result.DISABLE_TELEMETRY = "1";
  result.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return result;
}
