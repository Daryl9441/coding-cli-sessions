# Verified CLI compatibility

Checked on **2026-09-09** using the locally installed binaries. No model request was made. No credential/token file was opened. Raw login output was not retained in the project.

| Check                                                           | Result                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| `claude --help`                                                 | Success; Claude Code 2.1.114                              |
| `claude agents --help`                                          | Success                                                   |
| PATH `codex --help`, `codex exec --help`, `codex resume --help` | Initial npm installation 0.116.0 exited 137               |
| Installed app-bundled Codex, same three help commands           | Success; Codex 0.153.4                                    |
| `codex exec resume --help`                                      | Success with the working installed binary                 |
| `claude auth status --json`                                     | Official status reported logged in; only boolean retained |
| `codex login status`                                            | Official status reported logged in; only boolean retained |
| Node / Raycast                                                  | Validation uses Node 24.19.0; Raycast 2.2.1 installed     |

Help evidence is stored under `docs/help/`; it contains help text only. Executable discovery checks common installation directories and an installed Codex/ChatGPT application bundle. An explicit preference path always takes precedence.

## Claude Code

The installed CLI supports `-p`, `--output-format stream-json`, `--include-partial-messages`, `--verbose`, `--no-session-persistence`, `--resume`, `-c`, and tool allow/deny rules. Permission choices are `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`. Actual mode availability is checked from help at launch. Hook installation is not part of v1; configured hooks remain the CLI's responsibility.

Official references: [programmatic execution](https://code.claude.com/docs/en/headless), [hooks](https://code.claude.com/docs/en/hooks), and [Claude data directory](https://code.claude.com/docs/en/claude-directory).

The long-project-path encoder was verified from the published `@anthropic-ai/claude-agent-sdk@0.2.114`, matching the local Claude release. It replaces each non-ASCII-alphanumeric UTF-16 code unit with `-`. Above 200 encoded characters, it uses the first 200 plus `-` and the base-36 absolute signed 32-bit rolling hash of the original path. This is a version-specific implementation detail, not a universal stable filesystem API. Golden vectors include 201-character and long Chinese paths. The monitor discovers eligible directories rather than relying solely on reconstructing a guessed path.

## Codex

The verified CLI accepts `exec --json`, `exec --sandbox`, `exec --config`, `exec --ephemeral`, and nested `exec resume`. Interactive resume is a separate command. Exec options such as sandbox are placed before `resume`; resume-specific flags follow it. Stdin is selected with the final `-` argument.

The requested `--ask-for-approval` flag does not exist on this version's `exec` command. The root interactive command advertises `on-request` and `never`, but those are not evidence of headless support. The exact release's [exec implementation](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/exec/src/lib.rs) supplies `AskForApproval::Never` for ordinary headless execution. Consequently, the adapter rejects `on-request` and `untrusted`; setting the config to those values would misrepresent effective policy. The proposed never-only behavior must be accepted as a requirement exception before Store submission.

The adapter disables supported analytics, feedback, OpenTelemetry exporters, prompt export, and command-history persistence through explicit config values. These controls do not prevent model-provider traffic or arbitrary tools authorized by the selected sandbox.

Official references: [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), and [versioned CLI definition](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/exec/src/cli.rs).

## Raycast

The manifest uses top-level `commands`, `preferences`, `categories`, and `platforms`; it has no invented nested `raycast` field. Preferences use `getPreferenceValues()`. The project builds native React primitives from `@raycast/api` rather than browser markup.

Store metadata requires a valid Raycast author, the 512×512 icon, and actual high-resolution screenshots. A GitHub username is not proof of a Raycast profile. The provisional author remains a release blocker until verified. References: [manifest](https://developers.raycast.com/information/manifest), [prepare for Store](https://developers.raycast.com/basics/prepare-an-extension-for-store), and [publishing](https://developers.raycast.com/basics/publish-an-extension).
