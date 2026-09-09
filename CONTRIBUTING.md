# Contributing

Use Node.js 24 and run the README validation commands before a PR. Keep the CLI adapters, lifecycle state machine, read-only monitor, process boundary, and native UI separate. Do not add runtime dependencies without explaining their privacy impact.

Check actual installed `--help` before changing flags. Record the CLI version and official source supporting behavioral assumptions in `docs/compatibility.md`. Do not infer approval behavior from a flag merely being accepted. Keep interactive and headless resume semantics separate.

Integration tests must use `tests/fixtures/*.mjs` executables. Never call paid model APIs from tests or CI. Add meaningful cases for new parser branches and lifecycle transitions. Parser and state-machine branch coverage must remain 100%; aggregate source statement coverage must remain at least 80%.

Do not read or copy authentication/token files. Do not add shell execution, full environment forwarding, analytics, telemetry uploads, password preferences, or automatic global hook configuration. Changes to filesystem/process boundaries require explicit review in the PR description.

Use synthetic project paths, prompts, and outputs in screenshots. Native UI acceptance and Store submission are separate from automated unit tests. Do not mark a release published until the actual publishing step succeeds and Store review status is known.
