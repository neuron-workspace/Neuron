# Context pack — build, CI, and releases

## Purpose

Turning the repository into installers people can run, and stopping regressions
before they get there.

## Key files

- `package.json` — scripts and the full `electron-builder` config.
- `.github/workflows/ci.yml` — install → typecheck → test → build → e2e.
- `.github/workflows/release.yml` — **fires on a version tag**, builds
  Windows/macOS/Linux, publishes one GitHub Release.
- `.github/workflows/pages.yml` — deploys `docs/` as the download site.
- `tools/package-env.mjs`, `tools/clean-build.mjs`, `tools/copy-htmx.mjs`.

## Current status

Version **0.4.2**, **Apache 2.0**, `NOTICE` present.

CI runs all four standing checks on `windows-latest`, on push to `main` and
`dev` and on every pull request. Verified working, and verified to *bite*: an
injected type error and a broken assertion each fail it.

Packaging targets: NSIS, portable and appx (Windows); DMG and ZIP (macOS);
AppImage and deb (Linux). `npmRebuild: false` with `asarUnpack` for `node-pty`
and `sql.js` — see below.

The remote is a **clean slate**: zero releases, zero tags, zero Actions runs,
deliberately cleared before a Microsoft Store submission.

## Decisions

- **D24 — version dropped 1.4.1 → 0.4.2**, possible exactly once, because the
  Store only accepts increasing versions after publication. Consequence:
  `electron-updater` will never offer 0.4.2 to an installed 1.4.x.
- **D23 — Apache 2.0**, prospective only; anything already published stays MIT.
- **D25 — CI runs E2E**, using the same `npm run test:e2e` a contributor runs, so
  the CI step cannot pass while the documented local command is broken.
- **D27 — push and release hold is ACTIVE.** No push, no tag, no release, no
  Pages deploy until the user lifts it.

## Security constraints

- **Never rebuild native dependencies.** `node-pty` ships ABI-stable N-API
  prebuilds and building winpty from source fails in this environment; `sql.js`
  ships a `.wasm`. `npmRebuild: false` + `asarUnpack` is deliberate, and an
  agent "helpfully" reinstalling can destroy the workspace (D4).
- Workflow permissions stay least-privilege.
- Builds are **unsigned**. SmartScreen and Gatekeeper warn. The Store signs the
  appx; the Releases-page installers are unsigned.
- Secrets never enter the repository. The appx placeholders are placeholders on
  purpose.

## Test commands

```bash
npm run typecheck && npm test && npm run build && npm run test:e2e
npm audit --omit=dev     # currently 1 high: js-yaml
npm run dist:dir         # unpacked local package, for a smoke check
```

## Known bugs

- **`appx` carries `REPLACE.WITH.PartnerCenter.IdentityName`,
  `CN=REPLACE-WITH-PARTNER-CENTER-PUBLISHER-ID`, and
  `REPLACE_WITH_PUBLISHER_DISPLAY_NAME`.** Hard submission blockers (T-020).
  Left loud rather than invented, so the package fails instead of building
  something unsubmittable.
- No code signing or notarization anywhere.
- CI is Windows-only. Adding Linux needs `xvfb` for the Electron E2E (D34).
- No release-smoke test: nothing installs an artifact and launches it.
- The renderer emits one ~1.8 MB chunk (CodeMirror language modes). A warning,
  not a failure.

## Next tasks

T-020 (appx identity) · code signing and notarization · release-smoke test ·
T-013 (`js-yaml`) · a decision on Linux CI.

**Before any release:** the tag is the trigger. `git tag v0.4.2 && git push
origin v0.4.2` builds and publishes all three platforms. That is the point of no
return, not the push.
