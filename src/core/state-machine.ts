import { LifecycleEvent, TaskState } from "./types";

const transitions: Record<TaskState, Partial<Record<LifecycleEvent, TaskState>>> = {
  starting: {
    started: "running",
    succeeded: "completed",
    failed: "failed",
    stop: "stopping",
    timeout: "timed-out",
    lost: "interrupted",
  },
  running: { succeeded: "completed", failed: "failed", stop: "stopping", timeout: "timed-out", lost: "interrupted" },
  stopping: {
    stopped: "cancelled",
    succeeded: "cancelled",
    failed: "cancelled",
    lost: "cancelled",
    timeout: "timed-out",
  },
  completed: {},
  failed: {},
  cancelled: {},
  "timed-out": {},
  interrupted: {},
};

export function transition(state: TaskState, event: LifecycleEvent): TaskState {
  return transitions[state][event] ?? state;
}

export function isTerminal(state: TaskState): boolean {
  return state !== "starting" && state !== "running" && state !== "stopping";
}
