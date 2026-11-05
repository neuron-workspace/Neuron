# Contributing to Neuron

Thank you for helping improve Neuron. This guide takes a clean clone through a
reviewable pull request. Neuron is licensed under Apache 2.0; contributing code
means it will be distributed under the repository's license.

## Your first contribution

If this is your first time here, this is the whole path:

1. **Pick an issue.** Start with
   [`good first issue`](https://github.com/neuron-workspace/Neuron/labels/good%20first%20issue).
   Each one names the files involved, what "done" looks like, and how to test
   it, so you should not need to ask anyone anything to begin. Once you know
   your way around, try
   [`difficulty: intermediate`](https://github.com/neuron-workspace/Neuron/labels/difficulty%3A%20intermediate)
   and then
   [`difficulty: advanced`](https://github.com/neuron-workspace/Neuron/labels/difficulty%3A%20advanced).
2. **Say you are taking it.** Comment on the issue, and **wait for a maintainer
   to assign it to you before you start writing code.** That is not
   bureaucracy: it is the only thing that stops two people building the same
   fix, and it is the worst outcome for whoever loses the race. A comment on its
   own is not a reservation until it is assigned.
3. **Set up** as described in [Prerequisites and setup](#prerequisites-and-setup)
   and run the four [checks](#verify-before-opening-a-pull-request) once
   *before* changing anything, so you know the baseline is green on your machine.
4. **Branch from `dev`, and open your pull request against `dev`.** ⚠️ GitHub
   will offer `main` as the target by default. **Change it to `dev`.** Pull
   requests aimed at `main` are retargeted rather than rejected, but it slows
   everything down.
5. **Stuck?** Ask on the issue. A question asked on day one is far cheaper than
   a pull request that went the wrong way for a week.

If an assigned issue goes quiet for **seven days** without an update, it is
released so someone else can pick it up. Tell us on the issue if you need longer;
that is always fine.

### What to expect from us

Neuron has one maintainer. Issues and pull requests are triaged **weekly**, so a
reply can take a few days. A pull request is not guaranteed to merge: one that
changes behaviour nobody agreed to, grows beyond its issue, or skips the checks
below will be sent back. The fastest route to a merge is a small change, tied to
an issue, with the checks run and the output described.

Everyone whose pull request is merged is credited in the release notes for the
version it ships in.

### About Hacktoberfest

**Hacktoberfest 2026 does not count pull requests toward rewards.** Its
organisers
[replaced PR counting with other activities](https://hacktoberfest.com/questions/)
this year, so a pull request here will not earn Hacktoberfest credit. We are
still glad to have your contribution; we just do not want anyone surprised.

## Before you code

Search existing issues and read the
[feature guide](../docs/features.md), [architecture](../docs/architecture.md),
and [development guide](../docs/development.md). For plugin work, also read the
[Plugin API](../docs/plugin-api.md); for HTMX views, read the
[HTMX view guide](../docs/htmx-views.md).

## Prerequisites and setup

You need **Node.js 22**, npm 10 or newer, Git, and Windows, macOS, or Linux with
a desktop session. Node 22 is the version CI tests on all three platforms; older
versions may work but are not tested, so a failure on them is not something we
can reproduce. Clone the repository and install exactly the versions in the
committed lockfile:

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

### Things specific to a desktop app

Neuron is an Electron app, and a few things about that catch people out:

- **`node-pty` is a native module** (it runs the built-in terminal). It ships
  prebuilt binaries for common platforms, so `npm ci` normally just works. If it
  fails compiling instead, you need your platform's C++ build tools — Visual
  Studio Build Tools on Windows, Xcode Command Line Tools on macOS,
  `build-essential` and Python on Linux. The `postinstall` step that fixes its
  file permissions is intentional; leave it alone.
- **The end-to-end tests open real windows.** They need a desktop session. On a
  headless Linux machine run them under a virtual display, as CI does:
  `xvfb-run --auto-servernum npm run test:e2e`.
- **Port 5174 must be free** before `npm run test:e2e`. The suite starts its own
  renderer and refuses to adopt one that is already running — deliberately, so
  it never tests code from a different checkout. If it says the port is in use,
  stop your `npm run dev` first.
- **Platforms genuinely differ.** File paths, file watching, keyboard shortcuts,
  window chrome and spawned processes all behave differently on Windows, macOS
  and Linux. If your change touches any of those, say which platforms you ran
  it on.
- **An IPC change touches three processes.** Anything that adds or changes a
  bridge between the app and the file system needs the main process, the
  preload script and the renderer tested together — see
  [the security rules](#preserve-the-security-boundaries) below.
- **Packaging and signing are maintainer-only.** You never need a certificate,
  a signing identity or a release secret to contribute, and no one will ask you
  for one. Unsigned local builds are expected.

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
app on the relevant operating system. For a bug fix, add or update a test that
fails without the fix; verify a failing UI assertion against the running product
before assuming the product is wrong.

### Show that it ran

A pull request is reviewed only once you have run it yourself. In the
**Testing** section, give:

- the commands you ran and your operating system, with each one passing. For
  E2E, paste the Playwright summary line, for example `3 passed (41s)`;
- for a new or changed test, confirmation that you watched it **fail** without
  your change, by reverting the fix or breaking the behaviour it guards. A test
  that cannot fail proves nothing.

"Not run locally, CI will check it" is not accepted. If you really cannot run
something, such as E2E on a machine with no desktop session, say exactly what you
did not run and why, and open the pull request as a **draft**. It becomes ready
for review once the missing check has passed, in CI or locally.

### Screenshots for interface changes

Any change a user can see needs screenshots in the pull request description,
uploaded to GitHub directly rather than linked from elsewhere:

- **before and after**, at the same window size and in the same state;
- a **light and a dark theme** when the change touches colour, contrast, borders
  or icons;
- a short **GIF or video** when the change is about motion, drag and drop,
  hover, focus or another interaction a still image cannot show;
- the demo workspace or throwaway notes only — never your own notes, file paths
  or account details.

A UI pull request without screenshots is returned to draft.

CI runs on **Windows, macOS and Linux** for every pull request and push to `dev`
and `main`. It installs with `npm ci`, then enforces the same typecheck, fast
tests, build, and Electron E2E command on all three. Playwright failure
artifacts are uploaded for seven days — download them from the failed run to see
what the app looked like when a test failed. A local pass is still required: CI
is confirmation, not a substitute for describing what you tested.

A test that passes on your machine and fails on one CI platform is usually a
real cross-platform difference, not flakiness. Linux CI has no GPU, for example,
so anything that renders through WebGL runs on a software renderer there. You
can reproduce that locally with `NEURON_SOFTWARE_GL=1 npm run test:e2e`.

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

## AI-assisted contributions

You may use AI tools. If one **materially** wrote, rewrote or reviewed any part
of your pull request, say so in the pull request description — which tool, and
which part. Autocomplete finishing a line does not need mentioning; a tool that
drafted a function or a test does.

This is not a penalty and it does not lower your chances. It tells the reviewer
where to look harder, which makes review faster for everyone.

Whatever produced the code, **you** are responsible for it:

- You understand every line you submit and can explain it on review. "The tool
  wrote it" is not an answer to a review question.
- It is correct, and you have run the checks rather than trusting that it works.
- You have the right to contribute it under this repository's licence.
- You did not paste secrets, API keys, or anyone's personal notes or workspace
  contents into a third-party tool while making it.

A pull request that looks generated and unreviewed — confidently wrong, never
run, describing code that does not exist, unrelated to its issue, or touching
files it has no reason to — is closed without detailed review.

## Write reviewable commits and a complete pull request

Use conventional, imperative commit subjects such as
`fix(editor): preserve escaped table pipes`. Keep commits intentional and
explain what was wrong and why the fix has its particular shape, not merely
which files changed. Do not include generated `dist/`, `release/`, test-result,
editor, or personal workspace files.

Complete every applicable section of the pull-request template:

- summarize the problem and user-visible behavior;
- list the exact checks and desktop scenarios you ran, and their results (see
  [Show that it ran](#show-that-it-ran));
- link the issue;
- call out data, compatibility, permission, dependency, and network effects;
- attach before and after screenshots for interface changes (see
  [Screenshots for interface changes](#screenshots-for-interface-changes)); and
- remove note contents, paths, tokens, and other sensitive data from logs and
  images.

Respond to review by updating the same focused branch. A pull request is ready
to merge only after review is resolved and all required checks pass.

## Get help or report a problem

Use [SUPPORT.md](SUPPORT.md) to choose between a usage question, bug report,
feature request, and private security report. Never disclose an unpatched
vulnerability in a public issue or pull request.
