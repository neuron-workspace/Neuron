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
| T-009 | **Security** — `will-navigate` guard in `src/main/main.ts` uses `url.startsWith('http://localhost:5174')`, which admits `http://localhost:5174@evil.com` (real host `evil.com`) and `http://localhost:51740`. The *privileged* app frame — preload bridge attached — can be navigated off-origin. Compare parsed scheme/host/port instead | Claude | `NEEDS_USER` | `feature/T-009-navigation-guard` | `src/main/main.ts`; new unit test under `tools/` | Guard rejects the userinfo, port-prefix and unparseable-host forms; existing dev + `file://` navigation still works; regression test added to `npm test` |
| T-010 | **Security** — `apiFragment` (`src/main/htmx/server.ts:575`) loads and interpolates workspace variables with **no** `variables.read` check, while the variables API (`:373`, `:380`) and document interpolation (`:271`) all gate on it. A view denied `variables.read` reads variable values through any fragment | Claude | `NEEDS_USER` | `feature/T-010-fragment-capability` | `src/main/htmx/server.ts`; `tools/htmx-views.test.mjs` | Fragment interpolation gates on `variables.read`; a fragment requested without the capability renders without variable values rather than failing the whole view; test asserts the denial |
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
- **T-009 … T-015 — transport implementation**, gated behind T-008's decision
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
| T-003 | **M0b** — `CODE_OF_CONDUCT.md`, issue forms, PR template | Codex | `5507990`, merged `e36c109`. All three issue YAMLs parse as issue-forms (11 / 7 / config fields); additions only; post-merge typecheck clean, 5/5 suites, build OK. Two review corrections — a `blob/dev` contact link that would 404 on `origin`, and a PR checklist superseded by T-002's `typecheck` script |
