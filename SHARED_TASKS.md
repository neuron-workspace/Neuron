# SHARED_TASKS.md — the task board

**This is the only task board.** Roadmap and design docs hold rationale; status
lives here and nowhere else (`DECISIONS.md` D2).

Statuses: `BACKLOG` · `NEEDS_USER` · `READY` · `IN_PROGRESS` · `BLOCKED` ·
`REVIEW` · `DONE`. A row becomes `DONE` only when its acceptance criteria have
been re-run and passed by Claude in this environment.

Owner is a single agent. Never "Codex + User" — anything needing human judgment
is owned by Claude (`AGENTS.md` §1).

---

Branch model is `feature/T-xxx-<slug>` → `dev` → `test` → `main` (D10). Claude
cuts and claims the branch before the delegation goes out.

## Active

Ordered by dependency, not priority. **Nothing in a later wave may start before
its wave-A dependency has merged**, because each wave's files are the previous
wave's output.

Branch model is `feature/T-xxx-<slug>` → `dev` → `test` → `main` (D10).

### Wave A — no dependencies, run in parallel

| ID | Task | Owner | Status | Touch scope | Why it is first |
| --- | --- | --- | --- | --- | --- |
| T-022 | **`.db` v2 multi-table** — schema overview, drill-in, back (D28) | Codex | `IN_PROGRESS` | `lib/db.ts`, `DbSurface.tsx`, `DbView.tsx`, `MDXPreview.tsx` (table attr only), `tools/db.test.mjs` | Renderer-only; touches nothing another wave needs |
| T-028 | **Remove `.nhtml` / `.ndash`; workspace views become plain `.html`** (D31) | Codex | `READY` | `src/main/main.ts`, `src/main/htmx/**`, `surfaces/index.ts`, `HtmxViewSurface.tsx`, `examples/**`, `docs/**`, `skills/**`, `tools/htmx-views.test.mjs`, `e2e/**` | **The unblocker.** Three later rows are shaped by whether views are `.html` |
| T-026 | **Graph panel** — floating square top-right, all nodes visible, themed three-tier colouring | Claude | `READY` | `GraphCanvas.tsx`, panel placement, `index.css` | Isolated to the graph; `impeccable` per D12 |

### Wave B — needs Wave A merged

| ID | Task | Owner | Status | Blocked by | Why |
| --- | --- | --- | --- | --- | --- |
| T-029 | **AI providers → Vercel AI SDK** (D32) | Codex | `BLOCKED` | T-028 | Both edit `src/main/main.ts`, a serialization point (`AGENTS.md` §8) |
| T-023 | **`Planner.db` + two task dashboards** (D29) | Codex | `BLOCKED` | T-022, T-028 | Needs the v2 reader to exist, and the dashboards must be `.html` |
| T-030 | **Third-party plugins as sandboxed HTML apps** (D33) | Codex | `BLOCKED` | T-028 | The sandbox it reuses only accepts plain HTML after T-028 |

### Wave C — after the surfaces stop moving

| ID | Task | Owner | Status | Why last |
| --- | --- | --- | --- | --- |
| T-012 | **E2E coverage** for tabs, search, tags, wiki-links, properties, canvas editing, `.db` editing, settings, terminal, automations, plugins, graph | Claude | `BACKLOG` | Specs written against surfaces that are mid-rewrite get rewritten too. Claude-owned: selectors written without running them are guesses (D21) |
| T-004 | **Reconcile `docs/roadmap/production-readiness-plan.md`** with reality | Claude | `BACKLOG` | Deliberately last. Reconciling a roadmap against a tree that is still changing produces a document stale on arrival |

### Independent — pick up any time

| ID | Task | Owner | Status | Note |
| --- | --- | --- | --- | --- |
| T-013 | `js-yaml` high-severity advisory reaching production deps (`fixAvailable: true`) | Claude | `BACKLOG` | One command; low real-world exposure (DoS on self-parsed frontmatter) |
| T-027 | Live view still shows MDX ESM lines as body text | Claude | `NEEDS_USER` | Recommend dimming as metadata, not hiding — hiding makes them uneditable |
| T-025 | `GET /api/v1/db` HTML fragment route (D30) | Claude | `OPTIONAL` | **No longer blocking.** D31 lets any view run scripts and parse JSON itself |

### Needs a decision from the user

| ID | Task | Note |
| --- | --- | --- |
| T-020 | `appx` Partner Center placeholders | Hard blocker for any Microsoft Store submission (D24) |
| T-021 | PTY inherits `process.env` wholesale; plugins run unsandboxed in-renderer | Both deliberate, neither written down as a decision |
| T-005 | Command registry — **unblocked by D26**, ready to delegate | Then T-006 dispatcher, then T-007 consumers |

**Serialization points.** These files may only ever have one writer at a time:
`src/renderer/App.tsx` (T-005 / T-006 / T-007), `src/main/main.ts` (T-028 then
T-029), `src/main/htmx/**` (T-028), `src/renderer/index.css`.

---

## Backlog (not yet decomposed — do not delegate from this section)

Source material, with the reason each is still here:

- **M2 — workspace layout engine** (split tree, tab groups, saved workspaces).
  `docs/roadmap/production-readiness-plan.md` §4. Blocked on M1 by design: it
  needs the command registry as its entry point.
- **M4 — recovery & data integrity** (snapshots, watcher/save race hardening).
  Rated the highest *production* priority in the plan's risk register (R4), and
  the strongest candidate to jump the queue ahead of M2.
- **UI polish items** — `docs/roadmap/deferred-work.md`. All marked "needs app":
  they require `npm run dev` (port 5174) and human eyes, so they are **Claude +
  user**, never delegated.
- **Graph view feature set** — `docs/roadmap/deferred-work.md` §2. The
  force-layout item would need a `d3-force` dependency decision first (D8).
- **M6 — extensibility & security**, incl. the adversarial HTMX suite for risk
  R2. Good delegation material once M0's CI gate exists to catch regressions.
- **T-030 … T-036 — transport implementation**, gated behind T-008's decision
  record and the user accepting it. If the record says migrate, the phases are
  fixed in this order and each is its own row: extract the route dispatcher out
  of the loopback server → add the protocol transport → runtime asset registry →
  view documents → HTMX API routes → migrate examples/templates/docs → retire or
  dev-flag the loopback server. The dispatcher extraction comes first
  specifically so the two transports can never diverge into two implementations
  of the same authorization logic. If the record says stay on loopback, these
  collapse to a single API-restructuring row.

---

## Done

| ID | Task | Owner | Evidence |
| --- | --- | --- | --- |
| T-001 | Commit the pre-existing working tree so `git status` is clean before any delegation (D6, D11) | Claude | 10 topic commits on `dev`, `86765ba`…`0ab7bd6`; `git status` clean; both `tsc` projects clean, 5/5 test suites pass, `npm run build` succeeds — all re-run on the committed state |
| T-002 | **M0a** — repo-wide `typecheck` script + CI gates on typecheck, `npm test`, and build (closes risk R7) | Codex | `9bdbf04`, merged `9726d31`. Gate proven to bite, not just to exist: a `number = "nope"` injected into `src/renderer/lib/keybindings.ts` made `npm run typecheck` exit **2** — which also proves the *second* tsc in the chain is reached — and a broken assertion in `tools/frontmatter.test.mjs` made `npm test` exit **1**. Both probes reverted, tree clean. Post-merge: typecheck clean, 5/5 suites, build OK |
| T-008 | Transport decision record for `neuron://` vs. loopback (D15) | Codex | `8d2026d`, merged `b23c919`. 730 lines; all 12 required sections; **decision: C — hybrid**, with "keep loopback" recorded as the fail-closed outcome. 14 citations (Electron 42.4.1 source, htmx docs, release record); 5 facts explicitly marked unverified and treated as gates. One added file, zero modifications. Post-merge: typecheck clean, 5/5 suites, build OK. **Implementation is not authorized by this row** |
| T-024 | **Bugs** — dead view session on first open, invisible error pages, MDX imports as prose, E2E teardown stall | Claude | Merged `059d0d3`. StrictMode double-mount + revoke-on-reopen raced; open() now ticketed and the webview keyed per session. Error docs carry self-contained styling. ESM statements skipped in Reading view. Teardown `rmSync` retried — the "flaky test" was a 60s worker-teardown timeout pinned to a random test. 3 consecutive clean runs, 2.7m → 48s |
| T-014 | **CI** — run the E2E suite in CI (D25) | Claude | Merged `00b2d90`. CI now runs install, typecheck, `npm test`, build, `npm run test:e2e`, with failure artifacts on failure only |
| T-016 | **Recovery UI** — version history panel over the T-015 journal (D19, D20) | Claude | `88a1bb6`. Side peek listing earlier versions with inline-confirm restore; first plugin enabled by default. **Found and fixed a T-015 defect**: save-on-keystroke produced one entry per keystroke, so the newest pre-image differed from the file by one character and 1000 entries was ~2 minutes of typing. Overwrites now coalesce per file per 2-minute window keeping the *oldest* entry; deletes never coalesce. 2 E2E tests; 18/18 green |
| T-018 | **Relicense + version** — Apache 2.0, version 0.4.2 (D23, D24) | Claude | Merged `abab763`. Canonical Apache text, `NOTICE` added, all user-facing MIT references updated |
| T-019 | **Docs** — feature guide, support policy, contributing guide | Codex | `f41021e`, merged `2d8fec8`. 530 lines across 3 files. Shortcut table matches `keybindings.ts` exactly; no invented features; no broken links. One correction: the draft said Neuron has no recovery screen — true when the job started, false when it finished |
| T-015 | **Data integrity** — pre-image write journal + restore over every write path (D19, D20) | Codex | `1b99a47`, merged `31563bc`. Four hooks; store in userData keyed by hashed root; capture cannot throw or block a write; restore verifies length + sha256; symlinks rejected lexically and resolved; oversize records a skip marker. `tools/journal.test.mjs` covers exact-byte restore through CRLF and multi-byte UTF-8, all three retention caps, per-workspace isolation, forged ids, paths outside the root, unwritable store. Verified it bites: neutering capture fails the suite (exit 1). `npm test` now **7 suites**; 16/16 E2E still green. **No IPC/UI surface yet — listing and restore are unreachable from the app** |
| T-009 | **Security** — parsed-origin navigation guard, replacing a `startsWith` prefix test | Claude | `2375572`, merged `0dd5d65`. New electron-free `src/main/navigation.ts` + `tools/navigation.test.mjs` (wired into `npm test`). Verified it bites twice over: restoring the prefix comparison fails the unit suite (exit 1), **and** makes the E2E test genuinely navigate the app frame to `example.com` — the exploit reproduced, not described |
| T-010 | **Security** — capability gate on fragment variable interpolation | Claude | `3418cf9`, merged `d760864`. Denied session renders `<p> / me</p>` — variable blanked, params intact, still 200. Verified it bites: removing the gate fails the suite (exit 1) |
| T-011 | **E2E** — Playwright harness driving the real Electron app | Claude | `25d6812`, merged `1f7a71d`. 16 tests, 3 specs, all green in ~1.1 min. Per-test throwaway workspace + userData. Three *test* bugs found and fixed by checking the product first (reading-view default, permission prompt before render, `app.windows()` counting webview pages) — no product defect among them |
| T-003 | **M0b** — `CODE_OF_CONDUCT.md`, issue forms, PR template | Codex | `5507990`, merged `e36c109`. All three issue YAMLs parse as issue-forms (11 / 7 / config fields); additions only; post-merge typecheck clean, 5/5 suites, build OK. Two review corrections — a `blob/dev` contact link that would 404 on `origin`, and a PR checklist superseded by T-002's `typecheck` script |
