import { chmod, lstat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runtimeDirectory(): string {
  const suffix = `ccs-${process.getuid?.() ?? "local"}`;
  const preferred = join(tmpdir(), suffix);
  return preferred.length < 80 ? preferred : join("/tmp", suffix);
}

export function socketPath(): string {
  return join(runtimeDirectory(), "supervisor.sock");
}

export async function secureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()))
    throw new Error("Unsafe runtime directory");
  await chmod(directory, 0o700);
}
