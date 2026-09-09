# Test and acceptance matrix

Run `npm run test:coverage` using Node.js 24. No test invokes installed model CLIs or makes paid API requests. Executable fixture entrypoints are real executable `.mjs` files; they read stdin and emit structured stdout, including byte-split Unicode and malformed records.

| Area                    | Automated acceptance                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude parser           | Init/session, assistant text/tool, partial stream, result success/failure, denied permissions, missing fields, unknown records                                      |
| Codex parser            | Thread/turn/item/error events, tools, failures, unknown and incomplete schemas                                                                                      |
| State machine           | Every state/event combination; cancellation/completion races and absorbing terminal states                                                                          |
| Process lifecycle       | Normal exit, missing result, failure, timeout, SIGTERM-resistant fixture, external SIGKILL, disappearance after probing, child-group termination                    |
| Parallel tasks          | Independent state, managed-only stop, concurrency limit, duplicate running and concurrently starting resumes                                                        |
| JSONL                   | Invalid JSON, frame size bound, partial records, split multibyte UTF-8, large tool streams                                                                          |
| History                 | Allowed roots/names, symlink rejection, nested Codex paths, append/truncate/rotate/delete, bounded backlog, no prompt retention                                     |
| CWD encoding            | Punctuation, Unicode, 200-character boundary, >200-character signed-hash golden vectors                                                                             |
| Credentials/environment | CLI status reduces to boolean; missing/incompatible/unauthenticated fixtures; parent secret not inherited                                                           |
| Diagnostics             | Opt-in metadata-only logs, rejection of extra payload fields and symlink destinations, scoped deletion                                                              |
| IPC                     | User socket permissions, invalid requests, malformed responses, unavailable server, bootstrap coalescing, Node compatibility                                        |
| UI                      | Launch privacy defaults, both CLI forms, fixed resume engine, validation, broad-access confirmation, progress switching, stop, observed read-only view, diagnostics |

Coverage includes every `src/**/*.ts` and `src/**/*.tsx` file except the type contract. Native UI and supervisor bootstrap are included, even where a branch requires host-only acceptance. CI thresholds enforce ≥80% aggregate statements and 100% branches specifically for `src/adapters/parsers.ts` and `src/core/state-machine.ts`.

Other gates are TypeScript source and test checks, `ray build`, `ray lint`, formatting, the AST-based privacy scanner, gitleaks, and npm dependency auditing. No whole-module coverage exclusions are used to hide the UI.

## Native host acceptance still required before release

1. Import through `npm run dev` on an unlocked Mac with the target Raycast version.
2. Point Claude/Codex executable preferences at this repository's fixture scripts for the test. Use a synthetic temporary project directory and a compatible Node path.
3. Start a `slow` fixture task for each CLI. Verify live events, result status, parallel switching, and continued execution after closing/reopening the Raycast window.
4. Start `hang`, stop it through Raycast, and verify cancellation. Confirm that observed history has no stop or running-approval action.
5. Exercise a saved fixture session and inspect resume argv through the integration test evidence. The fixtures do not create production CLI history; actual transcript-reader behavior is separately tested in isolated temporary roots.
6. Verify empty, incompatible CLI, and startup policy views. Restore any executable preferences changed for fixture testing.
7. Capture at least two actual 2000×1250 Raycast screenshots with synthetic content. Do not substitute web mockups or generated screenshots.

Live provider-backed smoke tests are outside the automated suite and have not been run during initial implementation. Passing fixtures verifies the integration contract, not provider availability, billing entitlement, or every third-party CLI behavior.
