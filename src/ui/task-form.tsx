import { Action, ActionPanel, Alert, confirmAlert, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { useState } from "react";
import { ClaudePermission, Engine, Sandbox } from "../core/types";
import { client, settings } from "./client";

interface Values {
  engine: Engine;
  cwd: string;
  prompt: string;
  persist: boolean;
  timeout: string;
  permission: ClaudePermission;
  sandbox: Sandbox;
  allow: string;
  deny: string;
  debug: boolean;
}

export function TaskForm({
  engine: initialEngine = "claude",
  cwd = "",
  resume,
}: {
  engine?: Engine;
  cwd?: string;
  resume?: string;
}) {
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { pop } = useNavigation();

  async function submit(values: Values) {
    if (busy) return;
    if (!values.cwd.trim().startsWith("/") || !values.prompt.trim()) {
      setError("Enter an absolute project directory and a task prompt.");
      return;
    }
    const timeout = Number(values.timeout);
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 1440) {
      setError("Timeout must be between 1 and 1440 minutes.");
      return;
    }
    if (
      (engine === "claude" && values.permission === "bypassPermissions") ||
      (engine === "codex" && values.sandbox === "danger-full-access")
    ) {
      if (
        !(await confirmAlert({
          title: "Run with broad permissions?",
          message:
            "This task can make changes with reduced protections in the selected project. Confirm only for a trusted workspace.",
          primaryAction: { title: "Run Task", style: Alert.ActionStyle.Destructive },
        }))
      )
        return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const pref = settings();
      await client.start({
        engine,
        cwd: values.cwd.trim(),
        prompt: values.prompt,
        executable: (engine === "claude" ? pref.claudePath : pref.codexPath) || undefined,
        resume,
        persistSession: values.persist,
        timeoutMs: timeout * 60000,
        claudePermission: values.permission || "dontAsk",
        sandbox: values.sandbox || "read-only",
        codexApproval: "never",
        allowedTools: (values.allow ?? "")
          .split("\n")
          .map((r) => r.trim())
          .filter(Boolean),
        deniedTools: (values.deny ?? "")
          .split("\n")
          .map((r) => r.trim())
          .filter(Boolean),
        debug: values.debug,
      });
      await showToast({
        style: Toast.Style.Success,
        title: "Task started",
        message: "Progress is available in Manage Coding Sessions",
      });
      pop();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Unable to start task";
      setError(message);
      await showToast({ style: Toast.Style.Failure, title: "Task could not start", message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form
      navigationTitle={resume ? "Resume Coding Session" : "Start Coding Task"}
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={resume ? "Resume Session" : "Start Task"} onSubmit={submit} />
        </ActionPanel>
      }
    >
      {resume ? (
        <Form.Description title="CLI" text={engine === "claude" ? "Claude Code" : "Codex"} />
      ) : (
        <Form.Dropdown id="engine" title="CLI" value={engine} onChange={(v) => setEngine(v as Engine)}>
          <Form.Dropdown.Item value="claude" title="Claude Code" />
          <Form.Dropdown.Item value="codex" title="Codex" />
        </Form.Dropdown>
      )}
      {resume && (
        <Form.Description
          title="Session"
          text={resume === "last" ? "Most recent session in the selected project" : resume}
        />
      )}
      <Form.TextField id="cwd" title="Project Directory" defaultValue={cwd} placeholder="/absolute/path/to/project" />
      <Form.TextArea
        id="prompt"
        title="Task"
        placeholder="Describe the work to perform…"
        error={error}
        onChange={() => setError(undefined)}
      />
      <Form.Separator />
      {engine === "claude" ? (
        <>
          <Form.Dropdown id="permission" title="Permission Mode" defaultValue="dontAsk">
            <Form.Dropdown.Item value="dontAsk" title="Deny Unapproved Tools (dontAsk)" />
            <Form.Dropdown.Item value="plan" title="Plan Only" />
            <Form.Dropdown.Item value="default" title="Default Policy / Existing Hooks" />
            <Form.Dropdown.Item value="acceptEdits" title="Accept File Edits" />
            <Form.Dropdown.Item value="auto" title="Auto Policy (When Supported)" />
            <Form.Dropdown.Item value="bypassPermissions" title="Bypass Permissions (Broad Access)" />
          </Form.Dropdown>
          <Form.TextArea
            id="allow"
            title="Allow Tool Rules"
            placeholder={"One rule per line, e.g.\nRead\nBash(git status *)"}
          />
          <Form.TextArea id="deny" title="Deny Tool Rules" placeholder={"One rule per line, e.g.\nBash(rm *)"} />
          <Form.Description text="Policies and tool rules apply before launch. Existing CLI hooks are respected. This extension does not simulate interactive permission prompts." />
        </>
      ) : (
        <>
          <Form.Dropdown id="sandbox" title="Sandbox" defaultValue="read-only">
            <Form.Dropdown.Item value="read-only" title="Read Only" />
            <Form.Dropdown.Item value="workspace-write" title="Workspace Write" />
            <Form.Dropdown.Item value="danger-full-access" title="Full Access (Broad Permissions)" />
          </Form.Dropdown>
          <Form.Description
            title="Approval"
            text="Never — tools requiring approval are denied. Current Codex headless execution cannot honor on-request or untrusted interactive policies."
          />
        </>
      )}
      <Form.Separator />
      <Form.Checkbox
        id="persist"
        title="Session History"
        label="Save CLI session for future resume (plaintext in the CLI’s own storage)"
        defaultValue={false}
      />
      <Form.Description text="Off by default. Prompts are sent through stdin; results stay in supervisor memory. An unsaved new session cannot be resumed after it ends." />
      <Form.TextField id="timeout" title="Timeout (Minutes)" defaultValue="60" />
      <Form.Checkbox
        id="debug"
        title="Diagnostics"
        label="Write temporary diagnostic metadata only (no prompt or output)"
        defaultValue={false}
      />
    </Form>
  );
}
