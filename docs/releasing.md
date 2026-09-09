# Release checklist

The project is unreleased. Do not run Store publication while any required item below is unresolved.

## Release inputs

- [ ] Verify the maintainer's actual Raycast username and set `package.json` author. The provisional `daryl9441` currently fails Raycast profile lookup; do not replace it with an unrelated existing account to make lint pass.
- [ ] Accept the documented Codex never-only scope exception, or change the implementation to block incompatible Codex execution. Current 0.153.4 cannot implement the originally requested headless three-policy matrix.
- [ ] Complete native acceptance on an unlocked Mac. Record the Raycast and Node versions.
- [ ] Capture at least two genuine 2000×1250 screenshots and put them in `metadata/` following Raycast's naming convention.
- [x] Supply original 512×512 `assets/icon.png` and `Developer Tools` category.
- [x] Supply MIT License, README with privacy/security design, changelog, issue templates, and CI.

## Validation

Run after final metadata and screenshot changes:

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm run test:coverage
npm run check:privacy
npm run format:check
npm run lint
gitleaks dir . --redact --no-banner
gitleaks git . --redact --no-banner
npm audit
```

All required checks must pass. `ray lint` must have no errors or warnings, including author/profile validation. `ray build` must pass. Check the PR privacy checklist by reviewing actual source changes as well as static results. Verify the generated supervisor matches the source bundle.

## GitHub and Store

Create the authorized public GitHub repository only with project source, synthetic fixtures, documentation, and assets. Do not include `work/`, node_modules, coverage data, local transcripts, or credentials. Keep the project marked unreleased until submission is real.

After all gates pass, use:

```sh
npx ray publish
```

Raycast publication uses its official workflow to prepare a contribution to the extensions repository. A submitted PR still requires Store review; submission is not equivalent to Store availability. Do not use `npm publish`. This project's `prepublishOnly` intentionally rejects npm registry publishing.

The publishing CLI may require the maintainer to authenticate interactively. Use its official login flow; never inspect its token store. Record the resulting verified repository/PR URL and actual review status in the release notes.
