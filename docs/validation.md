# Local validation record

Recorded 2026-09-09 on macOS with Node.js 24.19.0. This describes checks actually executed, not a claim of Store acceptance.

| Check                                         | Observed result                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Installed CLI preflight                       | Claude 2.1.114 and working installed Codex 0.153.4 help/auth-status checks completed; both reported logged in |
| `npm run build` / `ray build -e dist`         | Passed: four entrypoints compiled, generated types checked, supervisor bundled                                |
| `npm run typecheck`                           | Passed: source `tsc --noEmit` and separate test type check                                                    |
| `npm run test:coverage`                       | Passed: 110 tests in 10 suites; no paid API calls                                                             |
| Aggregate source statements                   | 93.55% (798 / 853); native UI and bootstrap included                                                          |
| Aggregate branches                            | 88.62%                                                                                                        |
| Adapter parser branches                       | 100%                                                                                                          |
| Lifecycle state-machine branches              | 100%                                                                                                          |
| Privacy static gate and regression tests      | Passed                                                                                                        |
| `npm run format:check`                        | Passed                                                                                                        |
| gitleaks 8.30.1 working-tree scan             | No leaks found                                                                                                |
| `npm audit --audit-level=high`                | Zero vulnerabilities reported                                                                                 |
| `ray lint` code, icon, metadata, formatting   | Passed                                                                                                        |
| `ray lint` author validation                  | **Failed:** provisional `daryl9441` returned Raycast profile 404; actual author is required                   |
| Native Raycast acceptance and two screenshots | **Blocked:** Mac was locked; no screenshots fabricated                                                        |
| Paid-provider smoke test                      | Not run; only official help/login status and executable fixtures were used                                    |
| Raycast Store publication                     | Not run; release gates remain unresolved                                                                      |

The shipped supervisor bundle also passed an isolated end-to-end test: it started with a synthetic HOME, ran only an executable fixture, retained task state across separate IPC client connections, and shut down cleanly. A Linux CI finding involving inode reuse after transcript deletion was corrected by resetting unavailable-file cursors and tracking file birth time.

The Codex never-only proposal is not yet accepted as a change to the original three-policy requirement. See [compatibility](compatibility.md) and [release checklist](releasing.md). GitHub CI results, when available, are separate from these local checks.
