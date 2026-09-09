/** Matches @anthropic-ai/claude-agent-sdk 0.2.114 (Claude Code 2.1.114).
 * Hash ORIGINAL UTF-16 code units, not the replacement text; signed 32-bit, abs, base36.
 */
export function encodeClaudeCwd(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  if (encoded.length <= 200) return encoded;
  let hash = 0;
  for (let i = 0; i < cwd.length; i++) hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0;
  return `${encoded.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}
