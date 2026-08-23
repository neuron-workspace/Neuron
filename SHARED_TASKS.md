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

| ID | Task | Owner | Status | Branch | Touch scope | Acceptance evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T-012 | **E2E coverage** — extend the Playwright suite to the features the harness does not yet reach: tabs, search, tags, wiki-links, properties/frontmatter, task checkboxes, tables, canvas editing + undo/redo, `.db` row/schema editing, settings + theme presets, keybinding rebinding, terminal, automations, plugins, graph, browser tabs | Claude | `BACKLOG` | one branch per area | `e2e/**` only | Each area has a spec that fails if the feature breaks; full suite green; no test asserts on a selector it did not verify against the running app |
| T-020 | **Store submission** — replace the `appx` Partner Center placeholders (`identityName`, `publisher`, `publisherDisplayName`) with real values. Blocks any Microsoft Store submission (D24) | Claude | `NEEDS_USER` | `feature/T-020-appx-identity` | `package.json` `build.appx` only | `npm run dist:store` produces a submittable package |
| T-021 | **Untracked exposure** — the PTY spawns a real shell with `env: process.env` inherited wholesale, and plugins run in-renderer with the full `electronAPI` (risk R3). Both are deliberate "trusted code" designs, but neither is written down as a decision | Claude | `NEEDS_USER` | — | `DECISIONS.md` | A recorded decision accepting or constraining each |
| T-013 | **Dependency** — `js-yaml` high-severity advisory (CVE-2026-59870, quadratic CPU) reaches production deps transitively; `npm audit --omit=dev` reports it, `fixAvailable: true`. Pre-existing, unrelated to Playwright | Claude | `BACKLOG` | `package.json`, `package-lock.json` | `npm audit --omit=dev` clean; four standing checks green; E2E suite green |
| T-008 | **Transport evaluation** — `neuron://` custom protocol vs. the loopback HTTP server; decision record only (D15) | Codex | `DONE` | `feature/T-008-protocol-research` | `docs/architecture/neuron-protocol-api.md` | See Done table |
| T-004 | **M0c** — reconcile `docs/roadmap/production-readiness-plan.md` with reality (its §11 "next task" and several inventory rows are stale — e.g. the `.vw` README fix is already done) | Claude | `BACKLOG` | `feature/T-004-roadmap-sync` | `docs/roadmap/*` | Every claim in the plan's inventory table re-verified against the tree; §11 points at this board |
| T-005 | **M1a** — central typed command registry `{ id, title, scope, when(), run(), defaultKeys[] }` | Codex | `NEEDS_USER` | `feature/T-005-command-registry` | TBD at packet time; **serializes on `src/renderer/App.tsx`** | Registry unit tests (registration, duplicate id, scope precedence); palette behaviour unchanged; four standing checks green |
| T-006 | **M1b** — focus-scoped keyboard dispatcher + versioned hotkey schema + migration from the current flat map | Codex | `BACKLOG` (depends on T-005) | `feature/T-006-key-dispatcher` | `src/renderer/lib/keybindings.ts`, `App.tsx` dispatcher; **serializes on `App.tsx`** | Chord-normalization, conflict-detection, scope-precedence and migration tests; existing user bindings preserved; no double-fire; IME composition and `defaultPrevented` respected |
| T-007 | **M1c** — command palette + settings hotkey editor consume the registry; delete the scattered wiring | Codex | `BACKLOG` (depends on T-005, T-006) | `feature/T-007-registry-consumers` | `components/CommandPalette.tsx`, `views/SettingsPage.tsx`; **serializes on `App.tsx`** | No `keydown` handler outside the dispatcher; add/remove/disable/reset all work; four standing checks green |

T-005 is `NEEDS_USER` because the registry's scope list and the `Ctrl/Cmd+L`
default (plan §7) are product decisions that must be recorded in `DECISIONS.md`
before a packet can be written — a non-interactive agent would otherwise guess.

**Serialization note:** T-005, T-006 and T-007 all touch `src/renderer/App.tsx`
and must run strictly one at a time in this checkout (`AGENTS.md` §8). They are
**not** parallel-safe with each other or with anything else touching `App.tsx`.

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
| T-014 | **CI** — run the E2E suite in CI (D25) | Claude | Merged `00b2d90`. CI now runs install, typecheck, `npm test`, build, `npm run test:e2e`, with failure artifacts on failure only |
| T-016 | **Recovery UI** — version history panel over the T-015 journal (D19, D20) | Claude | `88a1bb6`. Side peek listing earlier versions with inline-confirm restore; first plugin enabled by default. **Found and fixed a T-015 defect**: save-on-keystroke produced one entry per keystroke, so the newest pre-image differed from the file by one character and 1000 entries was ~2 minutes of typing. Overwrites now coalesce per file per 2-minute window keeping the *oldest* entry; deletes never coalesce. 2 E2E tests; 18/18 green |
| T-018 | **Relicense + version** — Apache 2.0, version 0.4.2 (D23, D24) | Claude | Merged `abab763`. Canonical Apache text, `NOTICE` added, all user-facing MIT references updated |
| T-019 | **Docs** — feature guide, support policy, contributing guide | Codex | `f41021e`, merged `2d8fec8`. 530 lines across 3 files. Shortcut table matches `keybindings.ts` exactly; no invented features; no broken links. One correction: the draft said Neuron has no recovery screen — true when the job started, false when it finished |
| T-015 | **Data integrity** — pre-image write journal + restore over every write path (D19, D20) | Codex | `1b99a47`, merged `31563bc`. Four hooks; store in userData keyed by hashed root; capture cannot throw or block a write; restore verifies length + sha256; symlinks rejected lexically and resolved; oversize records a skip marker. `tools/journal.test.mjs` covers exact-byte restore through CRLF and multi-byte UTF-8, all three retention caps, per-workspace isolation, forged ids, paths outside the root, unwritable store. Verified it bites: neutering capture fails the suite (exit 1). `npm test` now **7 suites**; 16/16 E2E still green. **No IPC/UI surface yet — listing and restore are unreachable from the app** |
| T-009 | **Security** — parsed-origin navigation guard, replacing a `startsWith` prefix test | Claude | `2375572`, merged `0dd5d65`. New electron-free `src/main/navigation.ts` + `tools/navigation.test.mjs` (wired into `npm test`). Verified it bites twice over: restoring the prefix comparison fails the unit suite (exit 1), **and** makes the E2E test genuinely navigate the app frame to `example.com` — the exploit reproduced, not described |
| T-010 | **Security** — capability gate on fragment variable interpolation | Claude | `3418cf9`, merged `d760864`. Denied session renders `<p> / me</p>` — variable blanked, params intact, still 200. Verified it bites: removing the gate fails the suite (exit 1) |
| T-011 | **E2E** — Playwright harness driving the real Electron app | Claude | `25d6812`, merged `1f7a71d`. 16 tests, 3 specs, all green in ~1.1 min. Per-test throwaway workspace + userData. Three *test* bugs found and fixed by checking the product first (reading-view default, permission prompt before render, `app.windows()` counting webview pages) — no product defect among them |
| T-003 | **M0b** — `CODE_OF_CONDUCT.md`, issue forms, PR template | Codex | `5507990`, merged `e36c109`. All three issue YAMLs parse as issue-forms (11 / 7 / config fields); additions only; post-merge typecheck clean, 5/5 suites, build OK. Two review corrections — a `blob/dev` contact link that would 404 on `origin`, and a PR checklist superseded by T-002's `typecheck` script |
