// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Task } from "../src/core/types";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  list: vi.fn(),
  forget: vi.fn(),
  inspect: vi.fn(),
  clearDebug: vi.fn(),
  toast: vi.fn(),
  hud: vi.fn(),
  confirm: vi.fn(),
  pop: vi.fn(),
  push: vi.fn(),
  prefs: vi.fn(),
}));
vi.mock("../src/ui/client", () => ({
  client: {
    start: mocks.start,
    stop: mocks.stop,
    list: mocks.list,
    forget: mocks.forget,
    inspect: mocks.inspect,
    clearDebug: mocks.clearDebug,
  },
  settings: () => ({}),
}));
vi.mock("@raycast/api", async () => {
  const R = await import("react");
  type P = Record<string, any>; // Native Raycast components are represented by DOM controls only in tests.
  const box = (p: P) => R.createElement("div", {}, p.children, p.actions);
  const action = (p: P) => R.createElement("button", { type: "button", onClick: p.onAction }, p.title);
  const Action = Object.assign(action, {
    SubmitForm: (p: P) => R.createElement("button", { type: "submit" }, p.title),
    Push: (p: P) => R.createElement("button", { onClick: () => mocks.push(p.target) }, p.title),
    CopyToClipboard: (p: P) => R.createElement("button", {}, p.title),
    Style: { Destructive: "destructive" },
  });
  const findSubmit = (node: any): any => {
    if (!node) return undefined;
    if (Array.isArray(node)) return node.map(findSubmit).find(Boolean);
    if (node.props?.onSubmit) return node.props.onSubmit;
    return findSubmit(node.props?.children);
  };
  const Form = Object.assign(
    (p: P) =>
      R.createElement(
        "form",
        {
          onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values: P = Object.fromEntries(new FormData(form));
            for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
              values[checkbox.name] = checkbox.checked;
            void findSubmit(p.actions)(values);
          },
        },
        p.children,
        p.actions,
      ),
    {
      TextField: (p: P) =>
        R.createElement("input", {
          name: p.id,
          "aria-label": p.title,
          defaultValue: p.defaultValue,
          onChange: () => p.onChange?.(""),
        }),
      TextArea: (p: P) =>
        R.createElement(
          R.Fragment,
          {},
          R.createElement("textarea", { name: p.id, "aria-label": p.title, onChange: () => p.onChange?.("") }),
          p.error && R.createElement("span", { role: "alert" }, p.error),
        ),
      Dropdown: Object.assign(
        (p: P) =>
          R.createElement(
            "select",
            {
              name: p.id,
              "aria-label": p.title,
              value: p.value,
              defaultValue: p.defaultValue,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => p.onChange?.(e.target.value),
            },
            p.children,
          ),
        { Item: (p: P) => R.createElement("option", { value: p.value }, p.title) },
      ),
      Checkbox: (p: P) =>
        R.createElement(
          "label",
          {},
          p.label,
          R.createElement("input", {
            name: p.id,
            type: "checkbox",
            defaultChecked: p.defaultValue,
            "aria-label": p.title,
          }),
        ),
      Description: (p: P) => R.createElement("p", {}, p.text),
      Separator: () => R.createElement("hr"),
    },
  );
  const List = Object.assign(box, {
    Section: box,
    EmptyView: (p: P) => R.createElement("div", {}, p.title, p.description),
    Item: (p: P) => R.createElement("div", {}, p.title, p.subtitle, p.actions),
  });
  const Detail = Object.assign((p: P) => R.createElement("div", {}, p.markdown, p.actions, p.metadata), {
    Metadata: Object.assign(box, { Label: (p: P) => R.createElement("span", {}, `${p.title}: ${p.text}`) }),
  });
  return {
    Action,
    ActionPanel: box,
    Form,
    List,
    Detail,
    Icon: new Proxy({}, { get: (_target, key) => String(key) }),
    Color: {},
    Alert: { ActionStyle: { Destructive: "destructive" } },
    Toast: { Style: { Success: "success", Failure: "failure" } },
    showToast: mocks.toast,
    showHUD: mocks.hud,
    confirmAlert: mocks.confirm,
    openExtensionPreferences: mocks.prefs,
    useNavigation: () => ({ pop: mocks.pop }),
  };
});
vi.mock("@raycast/utils", async () => {
  const R = await import("react");
  return {
    usePromise: (fn: () => Promise<unknown>) => {
      const [data, setData] = R.useState<unknown>();
      R.useEffect(() => {
        void fn().then(setData);
      }, []);
      return { data, isLoading: !data, revalidate: () => fn().then(setData) };
    },
  };
});

import { TaskForm } from "../src/ui/task-form";
import NewTask from "../src/new-task";
import Sessions from "../src/sessions";
import Diagnostics from "../src/diagnostics";
import ClearDebug from "../src/clear-debug-logs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.start.mockResolvedValue({ id: "task" });
  mocks.stop.mockResolvedValue(undefined);
  mocks.confirm.mockResolvedValue(true);
  mocks.list.mockResolvedValue({ tasks: [], observed: [] });
  mocks.clearDebug.mockResolvedValue({ removed: 2 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fillTask() {
  fireEvent.change(screen.getByLabelText("Project Directory"), { target: { value: "/tmp/project" } });
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Review the code" } });
}
describe("task launch UI", () => {
  it("starts Claude with privacy-safe defaults and stdin task content", async () => {
    render(<NewTask />);
    fillTask();
    fireEvent.click(screen.getByText("Start Task"));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.start.mock.calls[0][0]).toMatchObject({
      engine: "claude",
      persistSession: false,
      debug: false,
      claudePermission: "dontAsk",
      allowedTools: [],
      deniedTools: [],
    });
    await waitFor(() => expect(mocks.pop).toHaveBeenCalled());
  });
  it("starts Codex without missing-Claude-field errors and shows effective approval policy", async () => {
    render(<TaskForm engine="codex" />);
    fillTask();
    expect(screen.getByText(/Never — tools requiring/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Sandbox"), { target: { value: "workspace-write" } });
    fireEvent.click(screen.getByText("Start Task"));
    await waitFor(() =>
      expect(mocks.start).toHaveBeenCalledWith(
        expect.objectContaining({
          engine: "codex",
          sandbox: "workspace-write",
          codexApproval: "never",
          allowedTools: [],
        }),
      ),
    );
  });
  it("validates missing prompts and timeouts before calling the supervisor", async () => {
    render(<TaskForm />);
    fireEvent.click(screen.getByText("Start Task"));
    expect(screen.getByRole("alert").textContent).toContain("absolute");
    fillTask();
    fireEvent.change(screen.getByLabelText("Timeout (Minutes)"), { target: { value: "0" } });
    fireEvent.click(screen.getByText("Start Task"));
    expect(screen.getByRole("alert").textContent).toContain("1440");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("requires broad-access confirmation and keeps failures visible", async () => {
    mocks.confirm.mockResolvedValueOnce(false);
    render(<TaskForm />);
    fillTask();
    fireEvent.change(screen.getByLabelText("Permission Mode"), { target: { value: "bypassPermissions" } });
    fireEvent.click(screen.getByText("Start Task"));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.start.mockRejectedValueOnce(new Error("CLI unavailable"));
    fireEvent.click(screen.getByText("Start Task"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("CLI unavailable"));
  });
  it("keeps the original engine fixed when resuming a history entry", async () => {
    render(<TaskForm engine="codex" cwd="/tmp/project" resume="last" />);
    expect(screen.queryByLabelText("CLI")).toBeNull();
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Continue" } });
    fireEvent.click(screen.getByText("Resume Session"));
    await waitFor(() =>
      expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ resume: "last", engine: "codex" })),
    );
  });
});

const task: Task = {
  id: "task-1",
  engine: "claude",
  cwd: "/tmp/project",
  state: "running",
  startedAt: 1,
  updatedAt: 2,
  sessionId: "id",
  persistSession: false,
  policy: "dontAsk",
  events: [{ at: 1, kind: "progress", text: "![not an image](https://example.invalid)" }],
};
describe("live session list and diagnostics", () => {
  it("shows an empty state then surfaces supervisor errors", async () => {
    render(<Sessions />);
    await waitFor(() => expect(screen.getByText(/Your coding sessions, in one place/)).toBeTruthy());
    cleanup();
    mocks.list.mockRejectedValueOnce(new Error("Node missing"));
    render(<Sessions />);
    await waitFor(() => expect(screen.getByText(/Local supervisor unavailable/)).toBeTruthy());
  });
  it("switches into live progress and stops only a managed process", async () => {
    mocks.list.mockResolvedValue({ tasks: [task], observed: [] });
    render(<Sessions />);
    await waitFor(() => expect(screen.getByText("View Live Progress")).toBeTruthy());
    fireEvent.click(screen.getByText("View Live Progress"));
    cleanup();
    render(mocks.push.mock.calls[0][0]);
    await waitFor(() => expect(screen.getByText(/not an image/)).toBeTruthy());
    expect(document.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByText("Stop Task"));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith("task-1"));
  });
  it("offers resume for saved completed tasks, and read-only inspection for external history", async () => {
    mocks.list.mockResolvedValue({
      tasks: [{ ...task, state: "completed", persistSession: true }],
      observed: [
        {
          id: "external-id",
          engine: "codex",
          cwd: "/tmp/other",
          updatedAt: 2,
          activity: "quiet",
          summary: "Observed",
          source: "external-log",
        },
      ],
    });
    render(<Sessions />);
    await waitFor(() => expect(screen.getByText("Resume Session")).toBeTruthy());
    expect(screen.queryByText("Stop Task")).toBeNull();
    expect(screen.getByText("Resume After Original Task Stops")).toBeTruthy();
    fireEvent.click(screen.getByText("Clear Result from Memory"));
    expect(mocks.forget).toHaveBeenCalledWith("task-1");
    fireEvent.click(screen.getByText("Inspect Observed Session"));
    expect(mocks.push).toHaveBeenCalled();
    cleanup();
    render(mocks.push.mock.calls[0][0]);
    await waitFor(() => expect(screen.getByText(/External processes cannot be stopped/)).toBeTruthy());
  });
  it("reports only CLI capability status and clears metadata logs", async () => {
    mocks.inspect.mockResolvedValue({
      engine: "claude",
      version: "Fixture",
      executable: "/fixture",
      loggedIn: true,
      compatible: true,
      issues: [],
    });
    render(<Diagnostics />);
    await waitFor(() => expect(screen.getByText(/Login verified by CLI/)).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("Check Again"));
    });
    await ClearDebug();
    expect(mocks.hud).toHaveBeenCalledWith("Cleared 2 temporary diagnostic files");
  });
});
