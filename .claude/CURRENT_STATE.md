# CURRENT_STATE.md

**Last updated:** 2026-08-23 · **Branch:** `dev` · **Version:** 0.4.2 ·
**Licence:** Apache 2.0

Read this instead of auditing the repository. If it contradicts the code, the
code wins — and then **fix this file**.

---

## What Neuron is

A local-first Electron + React desktop workspace. You point it at a folder; the
`.md` / `.mdx` files in it are the source of truth. No account, no server, no
database. The folder stays fully usable without Neuron.

Privileged work — filesystem, settings, AI, network, PTY — lives in the main
process behind a narrow `contextBridge` preload allowlist. The renderer has no
Node, no `ipcRenderer`, and context isolation is on.

## Architecture

```
src/main/          Electron main
  main.ts          windows, IPC, chokidar watcher, atomic writes, PTY,
                   AI/net proxies, web-contents hardening, journal wiring
  preload.ts       contextBridge allowlist — no raw ipcRenderer
  navigation.ts    electron-free navigation policy (parsed-origin checks)
  journal.ts       electron-free pre-image write journal
  htmx/            loopback view server: sessions, path policy, manifests,
                   capability model, served CSS kit, route dispatch
src/renderer/
  App.tsx          shell, routing, editor modes, tabs, panels, keybindings
  surfaces/        extension → surface registry (canvas, db, html views)
  canvas/          JSON Canvas model, history, markdown
  lib/             frontmatter, keybindings, theme, sanitize-html, layout
  plugins/         in-renderer trusted modules + built-ins
tools/*.test.mjs   esbuild + node:assert unit suites
e2e/               Playwright driving the real Electron app
```

## Surfaces (file type → behaviour)

| Extension | Surface |
| --- | --- |
| `.md` / `.mdx` | Notes. Reading / Live / Split. Saves on every keystroke |
| `.canvas` | JSON Canvas board, Obsidian-compatible |
| `.db` | Typed database, plain JSON, atomic writes |
| `.html` | **Sandboxed view** — see below |
| folder + `neuron.app.json` | Folder mini-app, collapses to one explorer entry |

**`.nhtml` and `.ndash` are being removed** (`DECISIONS.md` D31). Any workspace
`.html` becomes a sandboxed view; one CSP with scripts allowed; `connect-src`
stays `'self'`. Migration is task **T-028**, in flight. Until it merges the old
extensions still exist in the tree.

## The view platform — Neuron's strongest differentiator

An HTML view runs in a sandboxed `<webview>`: no Node, no preload, no
`ipcRenderer`, its own partition, served over a loopback HTTP server with
per-view session tokens.

Every API call is gated by **capability → path policy → atomic write**. A view
with no manifest renders and can read nothing. First open raises an approval
prompt naming the capabilities requested.

`connect-src 'self'` is the load-bearing control: a view reaches the loopback
API and has **no route to the network**. That, not the file extension, is what
prevents exfiltration.

## Data integrity

`journal.ts` captures a **pre-image before every overwrite and delete**, across
all four write paths (`notes:write`, `notes:delete`, `apiFileWrite`,
`apiFileDelete`). The store lives in `userData`, keyed by hashed workspace root
— never inside the workspace, so it cannot sync through Git or OneDrive.

Capture cannot throw and never blocks a write. Restore verifies length and
sha256. Overwrites coalesce per file per 2-minute window keeping the **oldest**
entry; deletes never coalesce. Surfaced through the **Version history** side
peek (`Ctrl+J`), the one plugin enabled by default.

## Security posture

**Fixed and tested:** stored XSS in `MDXPreview` (allowlist sanitiser +
`tools/sanitize-html.test.mjs`); navigation guard prefix-match bypass
(`localhost:5174@evil.com` reached `evil.com` — now parsed-origin, three call
sites, unit + E2E regression); fragment interpolation leaking variables without
`variables.read`.

**Open, deliberate, undocumented as decisions (T-021):** the PTY spawns a real
shell with `env: process.env` inherited wholesale; plugins run in-renderer with
the full `electronAPI` and no sandbox.

**Open, tracked:** `js-yaml` high-severity advisory reaching production deps
(T-013); builds are unsigned; `appx` Partner Center placeholders block any Store
submission (T-020).

Details and history: `.claude/SECURITY_RISKS.md`.

## Testing

7 unit suites (`npm test`), 19 Playwright E2E tests against the real app
(`npm run test:e2e`, ~48s). CI runs install → typecheck → test → build → e2e on
`windows-latest`. Playwright's Electron support is officially experimental —
accepted with a revisit trigger (D34). See `.claude/TEST_STATUS.md`.

## Known incomplete

- Graph is a static hex lattice: no zoom, pan, or drag (T-026 redesigns it).
- No split-editor or tab-group layout engine (M2, behind M1).
- No central command registry — palette, keybindings and menus wire actions
  independently (T-005 → T-006 → T-007).
- `.db` is single-table; multi-table + schema overview is T-022, in flight.
- AI providers are five hand-rolled `fetch` modules; move to the Vercel AI SDK
  is T-029 (D32).
- Third-party plugins are unsandboxed; the plan is to reuse the view sandbox
  rather than add SES or QuickJS (D33, T-030).

## Production-readiness priorities

1. Land the in-flight wave: T-022 `.db` v2, T-028 plain-HTML views.
2. T-020 appx identity and code signing — hard Store blockers.
3. T-021 — write down the PTY and plugin trust model before shipping to
   strangers.
4. T-012 — E2E coverage for the two-thirds of features it does not reach.
5. T-013 — clear the dependency advisory.

**A push and release hold is active (D27).** Local commits continue; nothing
leaves the machine, no tags, no releases, until the user lifts it.
