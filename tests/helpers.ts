import { resolve } from "node:path";
import { StartRequest, Task } from "../src/core/types";
import { TaskManager } from "../src/runtime/manager";
import { isTerminal } from "../src/core/state-machine";

export const fixture = (name: string) => resolve("tests/fixtures", `${name}.mjs`);
export function request(overrides: Partial<StartRequest> = {}): StartRequest {
  return {
    engine: "claude",
    cwd: process.cwd(),
    prompt: "success",
    executable: fixture("claude"),
    persistSession: false,
    timeoutMs: 5000,
    claudePermission: "dontAsk",
    allowedTools: [],
    deniedTools: [],
    codexApproval: "never",
    sandbox: "read-only",
    debug: false,
    ...overrides,
  };
}
export async function settled(manager: TaskManager, id: string, timeout = 7000): Promise<Task> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const task = manager.list().find((item) => item.id === id)!;
    if (isTerminal(task.state) && manager.activeCount === 0) return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Fixture task did not settle");
}
