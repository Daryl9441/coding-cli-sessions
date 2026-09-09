## Change

Describe the concrete trigger, resulting behavior, and any CLI compatibility decisions.

## Validation

- [ ] `npm run build`, `npm run typecheck`, and `npm run lint` pass.
- [ ] `npm run test:coverage` passes with ≥80% statements and 100% parser/state-machine branches.
- [ ] `npm run check:privacy`, `npm run format:check`, and gitleaks pass.
- [ ] Integration tests use executable fixtures and make no paid API calls.

## Privacy review required for every PR

- [ ] No authentication/token file is read, parsed, forwarded, or logged.
- [ ] Every spawn uses an argument array, explicit `shell: false`, and the environment allowlist.
- [ ] Prompts/output remain off disk by default; optional debug contains only redacted metadata.
- [ ] No analytics, telemetry SDK, outbound extension client, password preference, or remote connection was introduced.
- [ ] UI accurately represents permission capabilities and external-session observation limits.
