# Coding CLI Sessions

A native Raycast extension for starting and observing local Claude Code and Codex CLI tasks. Tasks use the CLIs' structured JSON streams. A small local Node supervisor keeps managed tasks alive when the Raycast window closes.

[Public source repository](https://github.com/Daryl9441/coding-cli-sessions) · [Validation record](docs/validation.md)

**Status: unreleased.** Implementation and automated validation are available. Store submission still requires a verified Raycast author, native host acceptance and screenshots, and resolution of the Codex approval-policy compatibility exception described below. This project is independently maintained and is not affiliated with Anthropic or OpenAI.

## Requirements

- macOS and Raycast. Windows is outside v1 because the supervisor uses Unix sockets and Unix process groups.
- Node.js 24 recommended. Development tooling requires Node.js 22.22.2 or later; the supervisor requires Node.js 22 or later.
- Locally installed and signed-in `claude` and/or `codex`. Use each CLI's own login command outside this extension.
- Existing local project directories. The extension does not create a workspace implicitly.

The verified baseline is Claude Code **2.1.114**, Codex **0.153.4**, and Raycast **2.2.1**. Every launch probes the selected executable's current help and login status. Missing required flags prevent launch. See [compatibility evidence](docs/compatibility.md).

## Commands

| Raycast command             | Use                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Start Coding Task           | Select Claude Code or Codex, a directory, prompt, timeout, and permission policy.            |
| Manage Coding Sessions      | Switch between parallel tasks, watch progress, stop a managed task, or resume saved history. |
| Check Coding CLI Setup      | Check actual executable paths, versions, required flags, and CLI-reported login status.      |
| Clear Coding CLI Debug Logs | Delete only this extension's temporary diagnostic metadata files.                            |

Up to eight managed tasks can run concurrently. Results stay in supervisor memory, with bounded event buffers. Closing the Raycast window does not stop a task. With no active tasks or UI requests, the supervisor exits after five minutes and its in-memory results disappear.

For setup problems, specify an **absolute executable path** in extension preferences. An incompatible binary earlier on PATH can be bypassed using a working installed executable. Node may also be set explicitly; no password or token preferences exist.

### Permissions and resume

Claude supports startup permission modes and optional allow/deny tool rules. Existing CLI hooks remain under the user's CLI configuration. This extension neither installs global hooks nor simulates approval keystrokes. `dontAsk` is the default. Broad permission bypass requires explicit confirmation for that launch.

**Verified Codex headless limitation:** Codex 0.153.4 `exec` has no `--ask-for-approval` flag and ordinary headless execution internally forces `never`. The current implementation offers `never` with `read-only`, `workspace-write`, or `danger-full-access` sandboxing. `on-request` and `untrusted` are rejected. A `--config` override cannot truthfully turn this version into interactive approval mode. Full access requires confirmation. This is a documented deviation from the original requested three-policy Codex matrix, pending acceptance before release.

Save CLI session history is **off by default**. New Claude tasks use `--no-session-persistence`; new Codex tasks use `--ephemeral`. Enable the checkbox before launch when future resume is needed. CLI history, when enabled, is plaintext managed by the CLI itself. Resuming an existing history entry still reads that original transcript; disabling persistence is not a command to erase it.

Headless resume uses `claude -p --resume ID` / `-c` and `codex exec … resume ID` / `--last`. Separate adapter methods build the interactive `claude --resume ID` and `codex resume ID` commands. The Raycast task UI runs headless tasks only.

### Observing work started elsewhere

The extension discovers and reads only eligible transcript files under `~/.claude/projects` and `~/.codex/sessions`, including Codex date subdirectories. It tails appended bytes without modifying these files. Claude project path encoding is implemented and tested against the matching published SDK, including long Unicode paths.

Observed sessions show session/project metadata and semantic activity, without copying prompts, answers, or reasoning into the history list. The UI polls every 1.5 seconds and discovers new files approximately every 10 seconds. Quiet logs are **not proof that a process stopped**. External processes cannot be approved or terminated through this extension. Stop the original task before resuming its history here. An ephemeral external task without a transcript cannot be discovered through log tailing.

## Privacy and security design

- The extension never opens credential/token files, including Claude's credentials file or Codex's authentication file. Login verification delegates to official CLI status commands and retains only a boolean. The signed-in CLI itself necessarily handles its own authentication.
- Processes receive a typed argument array with `shell: false`. Prompts travel through stdin, never in command-line arguments. No PTY, terminal emulator, screen scraping, shell command interpolation, or remote Codex connection is used.
- The subprocess environment is allowlisted: `HOME`, `PATH`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, and `TZ`. Fixed privacy switches disable supported CLI telemetry. Secret environment variables, `NODE_OPTIONS`, custom token variables, and the complete parent environment are not forwarded.
- The extension makes no outbound network requests and has no analytics, Sentry, or crash-reporting dependencies. The selected CLI still connects to its model provider and can execute permitted tools; this is not an offline model or a guarantee about arbitrary user-configured hooks/tools.
- Prompts and output are not written by the extension. No Raycast persistent storage/cache holds them. With session saving off, official CLI session persistence is disabled. Project changes, user hooks, and other CLI-managed diagnostic files are outside the extension's storage controls.
- Optional debug files contain only event type, state, timestamp, and exit code in the system temporary directory. They never accept prompt/output/argv/env payloads. Secret-like patterns are additionally redacted. The clear command removes these files.
- Managed output is redacted in memory and rendered inside Markdown code fences so CLI text cannot create remote image requests. Redaction is a defense in depth pattern filter, not a guarantee that every possible secret can be recognized.
- A user-owned `0700` directory contains the `0600` Unix socket. No TCP listener is created. Same-user processes are inside the local trust boundary; this is not isolation from malware already running as your account.
- Transcript access is restricted by directory and filename shape, read-only handles, regular-file checks, and symlink rejection. It does not scan arbitrary home-directory files. See [architecture and limits](docs/architecture.md).

Every PR runs privacy static checks and gitleaks. The PR template also requires a human privacy review. Report security concerns without attaching credentials or real transcript content; see [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm run test:coverage
npm run check:privacy
npm run lint
npm run format:check
npm run dev
```

`build` bundles the transparent supervisor source into `assets/supervisor.cjs` before running `ray build`. `dev` does the same before `ray develop`. The native host remains the final acceptance environment; React tests mock Raycast primitives and do not substitute for actual screenshots or host testing.

All integration tests invoke executable fixture scripts. They simulate streaming bytes, Unicode, failures, hangs, external kills, child processes, resumes, and capability failures without contacting a model API. Coverage includes all TypeScript/TSX source except the type contract; parsers and the state machine require 100% branch coverage, and the whole source requires at least 80% statement coverage. See [test matrix](docs/testing.md).

The icon is original vector artwork rasterized by `npm run generate:icon`. Store screenshots must be captured from the actual Raycast extension using synthetic fixture data, following [release instructions](docs/releasing.md).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), and the [MIT License](LICENSE). Never attach local credentials, full transcripts, or real task prompts to issues or pull requests.
