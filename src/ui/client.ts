import { environment, getPreferenceValues } from "@raycast/api";
import { join } from "node:path";
import { homedir } from "node:os";
import { executableCandidates } from "../adapters/capabilities";
import { probe, spawnSupervisor } from "../runtime/process";
import { socketPath, runtimeDirectory, secureDirectory } from "../runtime/paths";
import { rpc } from "../runtime/ipc";
import { Capabilities, Engine, ObservedSession, StartRequest, Task } from "../core/types";

export interface Settings {
  claudePath?: string;
  codexPath?: string;
  nodePath?: string;
}
export interface Snapshot {
  tasks: Task[];
  observed: ObservedSession[];
}
let bootstrap: Promise<void> | undefined;

export function settings(): Settings {
  return getPreferenceValues<Settings>();
}

async function connect(): Promise<void> {
  try {
    await rpc(socketPath(), "ping", undefined, 1000);
    return;
  } catch {
    /* Start the local supervisor. */
  }
  await secureDirectory(runtimeDirectory());
  const candidates = await executableCandidates("node", settings().nodePath);
  if (!settings().nodePath && process.execPath) candidates.unshift(process.execPath);
  let node: string | undefined;
  for (const candidate of new Set(candidates)) {
    const result = await probe(candidate, ["--version"], homedir(), 3000);
    const version = /^v(\d+)\.(\d+)\.(\d+)/.exec(result.stdout.trim());
    if (result.code === 0 && version && Number(version[1]) >= 22) {
      node = candidate;
      break;
    }
  }
  if (!node) throw new Error("Node.js 22+ is required. Set its absolute path in extension preferences.");
  spawnSupervisor(node, join(environment.assetsPath, "supervisor.cjs"), socketPath(), homedir());
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      await rpc(socketPath(), "ping", undefined, 500);
      return;
    } catch {
      /* Wait for the socket. */
    }
  }
  throw new Error("Unable to start the local supervisor. Check the Node executable preference.");
}

async function request<T>(method: string, payload?: unknown): Promise<T> {
  bootstrap ??= connect().finally(() => {
    bootstrap = undefined;
  });
  await bootstrap;
  return rpc(socketPath(), method, payload, method === "start" || method === "inspect" ? 90000 : 15000) as Promise<T>;
}

export const client = {
  list: () => request<Snapshot>("list"),
  start: (payload: StartRequest) => request<Task>("start", payload),
  stop: (id: string) => request<void>("stop", { id }),
  forget: (id: string) => request<void>("forget", { id }),
  clearDebug: () => request<{ removed: number }>("clear-debug"),
  inspect: (engine: Engine) =>
    request<Capabilities>("inspect", {
      engine,
      executable: engine === "claude" ? settings().claudePath || undefined : settings().codexPath || undefined,
    }),
};
