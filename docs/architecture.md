# Architecture and decisions

## Structure

```text
src/
  adapters/       Capability probes, argv builders, structured event parsers
  core/           Types, input validation, privacy boundary, JSONL decoder, state machine
  monitor/        Allowed transcript paths, CWD encoding, bounded tails, semantic activity
  runtime/        Process ownership, memory-only task manager, Unix socket supervisor
  ui/            Raycast form, local IPC client, in-memory polling hook
  sessions.tsx   Managed and observed session lists and detail views
  new-task.tsx   Launch command
  diagnostics.tsx
  clear-debug-logs.ts
assets/          Original icon and reproducible supervisor bundle
tests/           Unit, native-component mock, and executable-fixture integration tests
scripts/         Build, icon generation, privacy gate, npm publishing guard
.github/         CI and contribution templates
```

Raycast commands can be unloaded independently of a running task. A standalone Node process therefore owns managed CLI children. Raycast communicates through a user-only Unix socket. The supervisor has no HTTP endpoint, outgoing network client, shell interpreter, downloaded executable, or authentication-file reader. `assets/supervisor.cjs` is generated directly from the checked-in TypeScript entrypoint.

## CliAdapter contract

The exact exported contract is in `src/core/types.ts`:

```ts
interface CliAdapter {
  readonly engine: "claude" | "codex";
  buildStart(request: StartRequest, capabilities: Capabilities): ProcessSpec;
  buildHeadlessResume(request: StartRequest, capabilities: Capabilities): ProcessSpec;
  buildInteractiveResume(executable: string, sessionId: string): { executable: string; args: string[] };
  parse(event: unknown): NormalizedEvent[];
}
```

`ProcessSpec` contains executable, argument array, working directory, and stdin input. Only the audited process module can spawn it. Parsers accept `unknown`, normalize recognized records, redact display text, and tolerate future event types. A result event is evidence of a turn outcome; final success also requires normal process exit with code zero. Stderr is drained and discarded.

Capability probes run before each task. They use the installed binary's help output and official auth-status commands. Their returned public model contains a login boolean and capability descriptions, never the authentication status payload. An explicit path is not silently replaced by another installation.

## Task state machine

| Current state       | Event                               | Next state  |
| ------------------- | ----------------------------------- | ----------- |
| starting            | started                             | running     |
| starting or running | succeeded                           | completed   |
| starting or running | failed                              | failed      |
| starting or running | stop                                | stopping    |
| starting or running | timeout                             | timed-out   |
| starting or running | lost                                | interrupted |
| stopping            | stopped, succeeded, failed, or lost | cancelled   |
| stopping            | timeout                             | timed-out   |
| any terminal state  | any event                           | unchanged   |
| any state           | unlisted event                      | unchanged   |

Terminal states are `completed`, `failed`, `cancelled`, `timed-out`, and `interrupted`. Completion records arriving after cancellation cannot turn a cancelled task into success. An exit without a recognized successful result is failure. A task killed externally is interrupted. Timeouts retain their classification while cleanup finishes.

There is no `awaiting-approval` state: this version has no implemented running approval transport. Startup policy is explicit. Claude tool denial records can appear in progress, but the UI does not claim it can grant a suspended request.

## Ownership and concurrency

- At most eight concurrent or starting tasks. Duplicate managed resumes are rejected, including races during capability probing.
- Each managed task has its own child process group. Stop sends SIGTERM and escalates to SIGKILL after 1.2 seconds if the owned child is still live. Pipes are released after that grace period so inherited descriptors do not hold a timed-out request open.
- No IPC method accepts a PID. Observed sessions are not process ownership evidence and cannot be killed.
- A task retains at most 200 events and approximately 16,000 characters of text, with an 8,000-character rolling partial response. At most 100 task summaries remain; older terminal results are pruned. These limits keep snapshots below the IPC response ceiling.
- The supervisor exits after five idle minutes with no active task. There is no task database or persisted output cache.

Unix process groups cannot guarantee cleanup of programs that deliberately detach themselves. A SIGKILL of the supervisor itself cannot execute its shutdown handler and can leave CLI children alive. Results for unsaved sessions are lost on supervisor exit. This is a local task supervisor, not a system service or durable job queue.

## Transcript observation

Only Claude UUID transcript names one directory below the projects root, and Codex UUID/rollout transcript names up to four directories below the sessions root, are eligible. Directory traversal, credential-like path segments, symlinks, and unrelated files are excluded. Each engine gets a bounded 5,000-entry scan; the newest 120 eligible files are followed. Very large history trees may contain older or unindexed sessions outside this bounded view.

File handles are read-only. The reader incrementally decodes UTF-8 and JSONL, handles incomplete final lines, and recovers from rotation, truncation, deletion, and malformed records. Reads are bounded to 512 KiB per file per refresh; initial metadata is sampled from the head and recent activity from the tail.

An observed session contains only ID, CLI, project, last modification time, and semantic activity. It does not establish OS process liveness. A previous completed turn can become active again when new transcript records arrive. UI detail views poll along with the list.

## Privacy tradeoffs

Ephemeral-by-default sessions minimize transcript persistence but cannot later be resumed as newly saved history. Enabling persistence is a deliberate pre-launch choice. The CLI's model traffic, repository writes, hooks, and independent diagnostics are outside the extension's own logging boundary. The README describes these limits without claiming that CLI execution leaves no traces on disk.

The environment allowlist favors installed account login over arbitrary environment-injected providers. Custom credential variables, custom CLI home variables, and environment-based remote configurations are intentionally unsupported in v1. Users with nonstandard layouts should expect capability diagnostics instead of implicit secret forwarding.

Static checks enforce the audited module boundaries and known forbidden operations; they complement code review rather than prove absence of every possible data-flow vulnerability. The Unix socket trusts the local user account. See `SECURITY.md` for filesystem race limitations.

## Key decisions

| Decision                        | Reason and consequence                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| Structured CLI streams          | Official events can be tested without parsing a terminal display.                            |
| Small detached supervisor       | Tasks survive Raycast command/window closure; Node is an explicit dependency.                |
| Startup permission policy       | Exposes actual headless behavior; no simulated approval UI.                                  |
| Codex never-only proposal       | Reflects verified 0.153.4 behavior; requires acceptance of a scope exception before release. |
| Read-only external observation  | Provides progress without attaching to or signalling unrelated processes.                    |
| No plaintext history by default | Reduces persistence; future resume requires opting into CLI history.                         |
| Bounded local memory            | Avoids a transcript database; results are intentionally not durable.                         |
| No remote support               | Keeps bearer-token routing and remote process ownership outside v1.                          |
