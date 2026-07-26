# HANDOFF.md

Append-only. **Newest first.** One entry per delegated job or per accepted
commit. Record the Codex job ID and session ID so follow-up work can
`--resume` instead of starting cold (`AGENTS.md` §7).

Entry template:

```
## [date] T-xxx — <title>
- Job / session: <codex job id> / <session id>   (or: n/a — Claude)
- Model / effort:
- Delegated: <objective, one line>
- Result: <what came back>
- Corrected: <what Claude changed>   Kept: <what Claude deliberately preserved>
- Verification: <the four standing checks + any task-specific evidence>
- Commit: <sha>
```

---

## 2026-07-26 T-008 — `neuron://` vs. loopback transport decision record

- Job / session: `task-ms1tzcr3-cho0ue` / `019f9e9a-5886-7de2-a340-74ed15ff4398`
- Model / effort: account default, **high** (architecture + security). 15m 36s.
- Delegated: settle whether an Electron custom protocol should replace the
  loopback HTTP transport for HTMX views — document only, no code (D15).
- Result: `docs/architecture/neuron-protocol-api.md`, 730 lines, all 12 required
  sections. **Decision: C — hybrid.** `neuron://` ships, loopback survives only
  behind a development-only flag, both behind one dispatcher. "Keep loopback" is
  recorded as the fail-closed fallback if the E2E gate fails.
- Corrected: nothing. Kept entirely as delivered — one added file, zero
  modifications, no code, and the citations hold up.
- Verification: 14 citations (Electron 42.4.1 source, htmx docs, release
  record); 5 facts explicitly marked unverified and framed as gates, not
  assumptions; no `bypassCSP` anywhere. Post-merge: typecheck clean, 5/5 suites,
  build OK.
- Commit: `8d2026d`, merged to `dev` as `b23c919`.

### Two current-code defects it surfaced — both confirmed by Claude, neither fixed

1. **`will-navigate` prefix match** (`src/main/main.ts`). Reproduced:
   `http://localhost:5174@evil.com/` passes `url.startsWith(...)` and its real
   host is `evil.com`; `http://localhost:51740/` passes too. This guard protects
   the **privileged app frame** (webviews return early), the one with the
   preload bridge attached. → row **T-009**.
2. **`apiFragment` skips `variables.read`** (`src/main/htmx/server.ts:575`).
   Confirmed by reading the file: the variables API gates at `:373`/`:380` and
   document interpolation gates at `:271`, but fragment interpolation loads
   variables unconditionally — so a view denied the capability reads the values
   through any fragment. → row **T-010**.

Both are independent of the transport decision and live in shipped code today.
They are **not** deferred to the migration.

---

## 2026-07-26 T-003 — Code of conduct, issue forms, PR template

- Job / session: `task-ms1u0qj6-dw2oxj` / `019f9e9b-52f8-7330-89c0-f86016555e00`
- Model / effort: account default, low (Markdown + YAML scaffolding).
- Delegated: give a first-time contributor a code of conduct and templates that
  collect what a maintainer needs without a follow-up round trip.
- Result: five files, additions only, in scope. Bug form collects app version,
  OS, install form, workspace file type, and an explicit data-loss dropdown.
  Blank issues disabled; security routed to private vulnerability reporting from
  both the config and the top of the bug form.
- Corrected: contribution contact link pointed at `blob/dev` — a branch that does
  not exist on `origin` and would have 404'd — changed to `blob/main`; PR
  testing checklist listed the two raw `tsc` invocations that T-002 replaced
  with `npm run typecheck` in this same batch.
  Kept: the visible `[MAINTAINER: ...]` enforcement placeholder (correct call —
  a fabricated address silently drops reports), the Contributor Covenant 2.1
  text, and the Electron-specific checklist items on the preload bridge and
  `nodeIntegration`.
- Verification: all three issue YAMLs parse as issue-forms (11 / 7 / config).
  Post-merge in the primary checkout: typecheck clean, 5/5 suites, build OK.
- Commit: `5507990`, merged to `dev` as `e36c109`.

---

## 2026-07-26 T-002 — CI gates on typecheck and tests

- Job / session: `task-ms1u0pem-sedo3y` / `019f9e9b-4db5-78c3-9794-5d837f011995`
- Model / effort: account default, medium (mechanical config).
- Delegated: make a type error or a failing suite fail CI (risk R7).
- Result: `typecheck` script covering both tsconfig projects; CI runs
  install → typecheck → test → build; push coverage extended to `dev`.
- Corrected: nothing. Kept as delivered — the diff was two files and minimal,
  and Node 20 plus the least-privilege `permissions` block were correctly left
  alone.
- Verification: **the gate was proven to bite, not merely to exist.** A
  `const x: number = "nope"` injected into `src/renderer/lib/keybindings.ts` made
  `npm run typecheck` exit 2 — which also proves the chain reaches the *second*
  tsc project, the specific way a half-covering typecheck script fails silently.
  A broken assertion in `tools/frontmatter.test.mjs` made `npm test` exit 1.
  Both probes reverted; tree clean. Post-merge: typecheck clean, 5/5 suites,
  build OK.
- Commit: `9bdbf04`, merged to `dev` as `9726d31`.

---

## 2026-07-26 T-002 / T-003 / T-008 — three parallel Codex jobs dispatched

- Approved by the user for parallel execution (D13). One worktree per task under
  `C:/Workspace/Projects/neuron-worktrees/`, one Codex job per worktree, all cut
  from `dev` at `1b0b632`.

  | Task | Job | Codex session | Effort | Branch / worktree |
  | --- | --- | --- | --- | --- |
  | T-002 CI gates | `task-ms1u0pem-sedo3y` | `019f9e9b-4db5-78c3-9794-5d837f011995` | medium | `feature/T-002-ci-gates` |
  | T-003 governance files | `task-ms1u0qj6-dw2oxj` | `019f9e9b-52f8-7330-89c0-f86016555e00` | low | `feature/T-003-governance` |
  | T-008 `neuron://` decision record | `task-ms1tzcr3-cho0ue` | `019f9e9a-5886-7de2-a340-74ed15ff4398` | high | `feature/T-008-protocol-research` |

- **Two dead jobs, superseded — do not resume these:**
  `task-ms1tz3ip-d4v2dw` (T-002) and `task-ms1tzbsu-0siqzo` (T-003) both failed
  in under 25s with `The 'gpt-5.3-codex-spark' model is not supported when using
  Codex with a ChatGPT account`. Neither wrote anything; both worktrees were
  clean afterwards. Recorded as D16 — route by effort, not by `--model`.
- `/codex:status` checked before dispatch (no jobs running) and after (exactly
  three, one per worktree, no duplicate forwarder launches).
- Packets stated explicitly that npm is absent from the worktrees **by design**
  (D14), so a missing-module error is not a blocker to report or repair.
- Not yet reviewed. Nothing merged, nothing committed by Codex, nothing pushed.

---

## 2026-07-26 T-001 — Commit the pre-existing working tree

- Job / session: n/a — Claude, no delegation.
- Delegated: nothing. This was the D6 precondition: the tree must be clean
  before any Codex job, or the "inspect the complete diff" review step cannot
  separate Codex's changes from the user's.
- Result: branch `dev` created from `main` (D10); ten topic-focused commits:

  | SHA | Commit |
  | --- | --- |
  | `86765ba` | `chore(dev): move the dev server to port 5174` |
  | `dc29f0d` | `feat(views): folder mini-apps, .ndash scripting dashboards, manifests under .neuron` |
  | `7cd2965` | `feat(views): rebuild the HTMX view stylesheet as a token-driven component kit` |
  | `1f20699` | `feat(sidebar): collapse folders by default and show mini-app folders as one entry` |
  | `c6fe9f9` | `feat(mdx): embed .db databases inline with <DbView />` |
  | `c8f0b79` | `feat(graph): theme-aware nodes, degree-based sizing, and three-tier focus` |
  | `c4d3394` | `refactor(design): add shared spacing/type tokens; delete the unused shadcn sidebar` |
  | `978aff8` | `docs(examples): demo content for mini-apps, .ndash dashboards, and DbView` |
  | `407e1db` | `docs: cover mini-apps, .ndash, and the design-system research; add a deferred-work index` |
  | `0ab7bd6` | `docs(workflow): add AGENTS, SHARED_TASKS, DECISIONS, and HANDOFF` |

- Corrected: nothing — this was the user's own existing work, committed as
  found. `main.ts` and `index.css` each carried two unrelated topics and were
  split at hunk level so the commits stayed honest.
  Kept: all of it; no behaviour was changed while committing.
- Verification (re-run on the committed state, not the working tree):
  `tsc` main clean · `tsc` renderer clean · 5/5 suites pass · `npm run build`
  succeeds. The ~1.8 MB CodeMirror chunk warning is pre-existing and tracked.
- Not pushed. `origin` still points at the pre-existing `main`; pushing needs
  explicit authorization.

---

## 2026-07-26 — Dual-agent workflow initialized

- Job / session: n/a — Claude, no delegation.
- Created `AGENTS.md`, `SHARED_TASKS.md`, `DECISIONS.md`, `HANDOFF.md`. None
  existed before; `.agents/HANDOFF.md` is a *different*, older document (the
  2026-06 repository-publication handoff) and is gitignored — it is not this
  file's predecessor and is not visible to a delegated agent.
- Baseline measured on the pre-existing working tree, before any change:
  - `npx tsc -p tsconfig.main.json --noEmit` → clean
  - `npx tsc -p tsconfig.renderer.json --noEmit` → clean
  - `npm test` → 5/5 suites pass (view-security, frontmatter 42 assertions,
    htmx-views, canvas-model, sanitize-html)
  - Working tree: 29 modified, 3 staged deletions/renames, 7 untracked paths.
    Not clean — see D6 and T-001.
- Baseline commit: `6434116` (v1.4.1). Only branch: `main`; only remote:
  `origin`.
- No delegation has been sent. No production code written.
