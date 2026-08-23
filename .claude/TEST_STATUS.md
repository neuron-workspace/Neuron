# TEST_STATUS.md

**Last actually run:** 2026-08-23 on `dev` @ `39f0469`, in the primary checkout.

**Rule: only record a result you observed.** A number copied from another
agent's report, or from an earlier run of different code, is worse than no
number — it is a false green that stops someone re-checking.

---

## Commands

| Command | Covers | Last result |
| --- | --- | --- |
| `npm run typecheck` | Both tsconfig projects — main **and** renderer | ✅ clean |
| `npm test` | 7 unit suites, below | ✅ 7/7 |
| `npm run build` | clean → main (+ htmx copy) → renderer bundle | ✅ |
| `npm run test:e2e` | 19 Playwright tests against the real Electron app | ✅ 19/19, ~48s |
| `npm audit --omit=dev` | Production dependency advisories | ⚠️ 1 high (`js-yaml`) |

`typecheck` must cover both projects. A single-project script reports green
while half the codebase is unchecked — that is why the chain exists and why the
regression probe injects its error into a **renderer** file.

## Unit suites (`tools/*.test.mjs`)

No framework: esbuild transpiles the TS, `node:assert` checks it.

| Suite | Covers |
| --- | --- |
| `test:views` | `view-security.ts` — URL safety, doc budget |
| `test:frontmatter` | Parse/serialise round-trip preservation (42 assertions) |
| `test:htmx` | View server: sessions, tokens, host spoofing, boot replay, path traversal, capability denial, fragments |
| `test:canvas` | Canvas model, history, geometry, unknown-field preservation |
| `test:sanitize` | XSS allowlist sanitiser (risk R1) |
| `test:navigation` | Parsed-origin guard, incl. the `@evil.com` and port-prefix bypasses |
| `test:journal` | Pre-image capture, exact-byte restore, retention caps, coalescing, workspace isolation, forged ids |

## E2E (`e2e/`, Playwright + `_electron`)

| Spec | Covers |
| --- | --- |
| `app.spec.ts` | Launch, explorer, open note, edit reaching disk, MDX ESM not rendered as prose |
| `surfaces.spec.ts` | Canvas, `.db`, view permission prompt, scripting dashboard, folder mini-app |
| `security.spec.ts` | No Node in renderer, allowlist not `ipcRenderer`, three navigation-guard regressions, sandboxed webview + partition, popup denial |
| `version-history.spec.ts` | Restore round-trip, empty state |

Each test gets a **throwaway copy** of `examples/demo-repo` and its own
user-data directory. The app writes to its workspace as you use it; a suite
pointed at the committed demo would rewrite it and the churn would surface in
someone else's commit.

## Known gaps

- **No coverage** for tabs, search, tags, wiki-links, properties editing, task
  checkboxes, tables, canvas *editing* and undo/redo, `.db` row/schema editing,
  settings and themes, keybinding rebinding, terminal, automations, plugins,
  graph, browser tabs. → **T-012**.
- No component-level tests; there is no DOM runner and adding one is an open
  decision.
- No adversarial security suite for the view platform (R2).
- No performance, a11y, or cross-platform suites.
- Playwright's Electron support is officially **experimental** (D34). Accepted,
  with a revisit trigger: if an Electron upgrade breaks `_electron.launch`,
  migrate rather than pin Electron.

## Before a change counts as complete

1. `npm run typecheck` — clean.
2. `npm test` — all suites, no skips.
3. `npm run build` — succeeds.
4. `npm run test:e2e` — if anything in `src/` changed.
5. **A new test must be proven to bite.** Break the thing it guards and watch it
   fail. Every security fix this session was verified that way; it is the only
   evidence that separates a test from a comment.
6. Update this file with what you ran and what actually happened.

## Resolved test-harness bugs, kept as warnings

- **"Flaky test" that was a teardown stall.** A different test failed each run.
  The cause was `Worker teardown timeout of 60000ms exceeded`, attributed to
  whichever test the worker was on: the fixture's `rmSync` raced Electron's file
  handles on Windows, since the main process watches that temp directory with
  chokidar. Retry + swallow. **A failure that moves between tests is a fixture
  bug, not a flaky test.**
- **A suite that opened real browser tabs.** See D22 and
  `.claude/SECURITY_RISKS.md`. Green runs told us nothing, because the effect
  left the test process entirely.
