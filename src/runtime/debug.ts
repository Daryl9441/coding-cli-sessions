import { constants } from "node:fs";
import { appendFile, lstat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { redact } from "../core/privacy";
import { secureDirectory } from "./paths";

export class DebugLogs {
  constructor(readonly directory: string) {}
  async write(id: string, metadata: { kind: string; state: string; code?: number | null }): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid debug ID");
    await secureDirectory(this.directory);
    // No prompt, output, argv, env, or authentication payload is accepted by this API.
    const line =
      redact(JSON.stringify({ at: Date.now(), kind: metadata.kind, state: metadata.state, code: metadata.code })) +
      "\n";
    await appendFile(join(this.directory, `debug-${id}.jsonl`), line, {
      mode: 0o600,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
    });
  }
  async clear(): Promise<number> {
    let count = 0;
    try {
      if ((await lstat(this.directory)).isSymbolicLink()) throw new Error("Invalid debug directory");
      for (const name of await readdir(this.directory)) {
        if (/^debug-[0-9a-f-]{36}\.jsonl$/i.test(name)) {
          await unlink(join(this.directory, name));
          count++;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return count;
  }
}
