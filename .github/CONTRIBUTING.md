# Contributing to Neuron

Thank you for helping improve Neuron. This guide takes a clean clone through a
reviewable pull request. Neuron 0.4.3 is licensed under Apache 2.0; contributing
code means it will be distributed under the repository's license.

Before coding, search existing issues and read the
[feature guide](../docs/features.md), [architecture](../docs/architecture.md),
and [development guide](../docs/development.md). For plugin work, also read the
[Plugin API](../docs/plugin-api.md); for HTMX views, read the
[HTMX view guide](../docs/htmx-views.md).

## Prerequisites and setup

You need Node.js 20 or newer, npm 10 or newer, Git, and Windows, macOS, or Linux
with a desktop session. Clone the repository and install exactly the versions
in the committed lockfile:

```bash
git clone https://github.com/neuron-workspace/Neuron.git
cd Neuron
npm ci
```

Do not use `npm install` for routine setup. Start the Electron app and its
watched renderer/main builds with:

```bash
npm run dev
```

The renderer development server uses port 5174. Stop the parent command to stop
all three development processes.

## Choose a focused change

Branches flow in this order:

```text
feature/* → dev → test → main
```

Create a focused `feature/*` branch from `dev`. Feature branches merge into
`dev` after review and verification. Release candidates move from `dev` to
`test`; only a verified `test` state moves to `main`. Do not open a feature
branch from `main` or target a feature pull request directly at `main`.

Keep a pull request to one problem. If a change affects file formats, autosave,
migration, deletion, settings, permissions, or recovery, describe the data and
compatibility risk and the rollback path before asking for review.

## Use the repository commands

The commands below are the scripts defined by `package.json`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite, watched main-process TypeScript, and Electron |
| `npm run typecheck` | Type-check the main/preload and renderer projects |
| `npm test` | Run the fast unit and integration suites |
| `npm run build` | Clean and build the main and renderer outputs |
| `npm run test:e2e` | Build the main process and drive the real Electron app with Playwright |
| `npm run dist:test` | Build a local test installer |
| `npm run dist:dir` | Build an unpacked test application |
| `npm run dist:store` | Build production Microsoft Store artifacts |
| `npm run release` | Build and publish a production release |

The development and distribution details live in
[docs/development.md](../docs/development.md) and
[docs/distribution.md](../docs/distribution.md). Do not run publishing commands
for an ordinary contribution.

## Verify before opening a pull request

Run all four standing checks from the repository root:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The E2E suite needs a desktop session and uses throwaway copies of the demo
workspace. For visible changes, also exercise the affected flow in the running
app on the relevant operating system and include screenshots. For a bug fix,
add or update a test that fails without the fix; verify a failing UI assertion
against the running product before assuming the product is wrong.

CI runs on Windows for pull requests and pushes to `dev` and `main`. It installs
with `npm ci`, then enforces the same typecheck, fast tests, build, and Electron
E2E command. Playwright failure artifacts are uploaded for seven days. A local
pass is still required: CI is confirmation, not a substitute for describing
what you tested.

## Preserve the security boundaries

Neuron treats workspace documents as untrusted input and keeps privileged work
in the Electron main process behind a narrow preload bridge. A contribution
must preserve these rules:

- Keep `contextIsolation` enabled and `nodeIntegration` disabled.
- Never import or use raw `ipcRenderer` in renderer code. Add the narrowest
  possible main-process handler and expose a named preload method instead.
- Do not create a generic filesystem or IPC proxy, unsafe template evaluation,
  arbitrary code execution route, or unrestricted third-party plugin loader.
- HTMX views must remain sandboxed, path-policy checked, capability checked,
  token authenticated, and unable to access the network unless a future
  recorded decision deliberately changes that model.
- Request the narrowest plugin capability and describe all network behavior.
  Never commit API keys, credentials, signing material, personal notes, or
  absolute workspace paths.
- Do not add a runtime dependency without a recorded project decision. A
  dependency change must include both `package.json` and `package-lock.json`
  and the appropriate build, test, and audit evidence.

Read [docs/htmx-views.md](../docs/htmx-views.md) before changing the view API or
permission model.

## Respect the project's non-goals

Neuron is not pursuing arbitrary code execution, a generic filesystem proxy,
raw renderer IPC, unsafe template evaluation, or unrestricted third-party
plugins with Node access. It will not delete user data or configuration without
a migration and backup, replace Markdown files with a block-editor JSON model,
or speculatively rewrite stable canvas, HTMX, or frontmatter subsystems. New
runtime dependencies require a recorded decision.

If a proposal needs one of those directions, open a focused feature request and
wait for an explicit architecture decision before implementing it.

## Write reviewable commits and a complete pull request

Use conventional, imperative commit subjects such as
`fix(editor): preserve escaped table pipes`. Keep commits intentional and
explain what was wrong and why the fix has its particular shape, not merely
which files changed. Do not include generated `dist/`, `release/`, test-result,
editor, or personal workspace files.

Complete every applicable section of the pull-request template:

- summarize the problem and user-visible behavior;
- list the exact checks and desktop scenarios run;
- link the issue;
- call out data, compatibility, permission, dependency, and network effects;
- attach screenshots for interface changes; and
- remove note contents, paths, tokens, and other sensitive data from logs and
  images.

Respond to review by updating the same focused branch. A pull request is ready
to merge only after review is resolved and all required checks pass.

## Get help or report a problem

Use [SUPPORT.md](SUPPORT.md) to choose between a usage question, bug report,
feature request, and private security report. Never disclose an unpatched
vulnerability in a public issue or pull request.
