import { constants } from "node:fs";
import { type FileHandle, lstat, open, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { Engine } from "../core/types";

export interface SessionFile {
  path: string;
  engine: Engine;
  mtime: number;
}
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const claudeName = new RegExp(`^${uuid}\\.jsonl$`, "i");
const codexName = new RegExp(`^(?:rollout-[0-9T:.Z_-]+-)?${uuid}\\.jsonl$`, "i");

export function sessionRoot(home: string, engine: Engine): string {
  return engine === "claude" ? join(home, ".claude", "projects") : join(home, ".codex", "sessions");
}

export function allowedSessionPath(home: string, engine: Engine, path: string): boolean {
  const inside = relative(sessionRoot(home, engine), resolve(path));
  const parts = inside.split(sep);
  if (inside.startsWith("..") || inside === "" || parts.some((part) => /(?:auth|credential|token|secret)/i.test(part)))
    return false;
  if (engine === "claude") return parts.length === 2 && claudeName.test(parts[1]);
  return parts.length <= 5 && codexName.test(parts[parts.length - 1]);
}

/** No symlinks at any segment below HOME; O_NOFOLLOW closes the final symlink race. */
export async function openSession(home: string, engine: Engine, path: string): Promise<FileHandle> {
  if (!allowedSessionPath(home, engine, path)) throw new Error("Not an allowed session transcript");
  let parent = resolve(home);
  const relativePath = relative(parent, resolve(path));
  for (const part of relativePath.split(sep)) {
    parent = join(parent, part);
    const stat = await lstat(parent);
    if (stat.isSymbolicLink()) throw new Error("Session symlinks are not followed");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new Error("Session must be a regular file");
  }
  return handle;
}

export async function discoverSessionFiles(home: string, limit = 120): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  let budget = 5000;
  async function visit(path: string, engine: Engine, depth: number): Promise<void> {
    if (depth > 4 || budget <= 0) return;
    let entries;
    try {
      if ((await lstat(path)).isSymbolicLink()) return;
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (--budget < 0) return;
      if (entry.isSymbolicLink()) continue;
      const target = join(path, entry.name);
      if (entry.isDirectory()) {
        if (engine === "codex" || depth === 0) await visit(target, engine, depth + 1);
      } else if (entry.isFile() && allowedSessionPath(home, engine, target)) {
        try {
          const stat = await lstat(target);
          files.push({ path: target, engine, mtime: stat.mtimeMs });
        } catch {
          /* Deleted while scanning. */
        }
      }
    }
  }
  for (const engine of ["claude", "codex"] as const) {
    budget = 5000;
    await visit(sessionRoot(home, engine), engine, 0);
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}
