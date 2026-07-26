# DECISIONS.md

Numbered, durable decisions for the Neuron dual-agent workflow and codebase.
A decision is only binding once it appears under **Accepted**. Nothing under
**Proposed** may be implemented.

Each row records **what**, **who approved**, and — the part that matters — the
**consequence**: what this forbids, or the specific trap it stops an
implementer from walking into.

---

## Accepted

### D1 — The four workflow documents live at the repository root and are tracked in git
**Approved:** Claude (2026-07-26), no user judgment required.
**Consequence:** `.agents/`, `.claude/`, `.codex/`, and `.impeccable/` are all in
`.gitignore`, so a delegated agent working from a clean checkout **cannot see
them**. Anything Codex must know goes in `AGENTS.md`, `SHARED_TASKS.md`,
`DECISIONS.md`, `HANDOFF.md`, or in the delegation packet itself. Never point a
delegation packet at a path under `.agents/`.

### D2 — `SHARED_TASKS.md` is the only task board
**Approved:** Claude (2026-07-26).
**Consequence:** `.agents/remaining-tasks.md`, `.agents/plans.md`,
`docs/roadmap/production-readiness-plan.md`, and `docs/roadmap/deferred-work.md`
remain valuable as *rationale and backlog material* but are **not status**.
The trap: those files contain stale "next task" lines (e.g. the plan's
"fix stale README `.vw` → `.nhtml`", which is already done). Believing a status
line in a roadmap doc instead of the board produces work that was already
finished. Status is read from, and written to, one file only.

### D3 — Standing verification command list
**Approved:** Claude (2026-07-26).
**Consequence:** the four commands in `AGENTS.md` §3 are re-run by Claude in this
environment for every task, regardless of what the delegated agent reports.
Baseline measured 2026-07-26 on the pre-existing working tree: both `tsc`
projects clean, all five test suites pass. Any red result after a delegation is
therefore attributable to that delegation, not inherited.

### D4 — A delegated agent never touches dependencies
**Approved:** Claude (2026-07-26).
**Consequence:** no `npm install` / `npm ci` / `electron-rebuild` / `node-gyp` /
lockfile or `node_modules` edits, and no "helpful" repair of a missing tool.
The trap is concrete and has already bitten this repo: `node-pty` is used
**without** rebuilding (`npmRebuild: false` + `asarUnpack`) because building
winpty from source fails here, and `sql.js` ships a `.wasm` that is unpacked the
same way. An agent that reinstalls to fix a sandbox `PATH` error can destroy the
workspace for everyone. A missing tool is reported, never diagnosed.

### D5 — Only Claude commits, and every commit is authored by the user alone
**Approved:** user (standing instruction, restated 2026-07-26).
**Consequence:** delegation packets always say **NO COMMIT**; Codex leaves work
uncommitted so the full diff can be reviewed against the recorded decisions
before anything enters history. Commits are authored by
`Shivam Khetan <shivkhetan18@gmail.com>` with **no `Co-Authored-By` trailer** for
Claude or Codex.

### D6 — The working tree is committed to a clean state before the first delegation
**Approved:** Claude (2026-07-26).
**Consequence:** at setup time the tree carried ~29 modified files, 3 staged
deletions/renames, and 7 untracked paths (HTMX theming, GraphCanvas, `.ndash`
dashboards, `DbView`, `appPaths`, roadmap docs). The review step in `AGENTS.md`
§9 is "inspect the **complete** diff" — with pre-existing uncommitted work in the
tree, a reviewer cannot tell Codex's changes from the user's, which is exactly
how out-of-scope edits get committed unnoticed. No delegation goes out until
`git status` is clean.

### D7 — `package.json` is editable only inside the `scripts` block, and only when a task explicitly allows it
**Approved:** Claude (2026-07-26).
**Consequence:** this is the narrow carve-out that lets tooling tasks (adding a
`typecheck` script) proceed without reopening D4. `dependencies`,
`devDependencies`, `overrides`, `build`, and `package-lock.json` stay forbidden
in every packet. A packet that allows `package.json` must say "`scripts` block
only" in so many words.

### D8 — No new runtime dependency without its own numbered decision
**Approved:** Claude (2026-07-26), carrying forward the recorded roadmap stance.
**Consequence:** `docs/roadmap/deferred-work.md` names exactly one dependency
genuinely on the table (`d3-force`, for graph layout), and it is not approved —
it needs its own decision entry first. Any delegation that finds itself wanting a
package must stop and report, not add one.

### D9 — Next milestone: M0 (CI gates), then M1 (command & keyboard architecture)
**Approved:** user (2026-07-26).
**Consequence:** M0 goes first because risk **R7** ("CI merges regressions") is
rated High likelihood with *no* control — CI runs `npm run build` only, so
neither type check nor any of the five test suites gates a merge. Until that
lands, every delegated diff is guarded only by Claude re-running the checks by
hand, and a mistake between reviews reaches `dev` unnoticed. M1 then follows:
central command registry first, dispatcher second, consumers third. M2's layout
engine is deliberately blocked behind M1 — it needs the registry as its entry
point, and building layout commands on the current scattered `keydown` wiring
would extend exactly the anti-pattern M1 exists to remove.

### D10 — Branch model: `feature/* → dev → test → main`
**Approved:** user (2026-07-26).
**Consequence:** `main` is now release-only and never receives direct commits.
Delegated work lands on `feature/T-xxx-<slug>` off `dev`, is reviewed, then
merges to `dev`; a release candidate promotes `dev → test`, and only a `test`
state with all four standing checks green may merge to `main`. Every task row in
`SHARED_TASKS.md` therefore carries a branch. `.agents/BRANCH_RULES.md`
described this flow but it had never been adopted — only `main` existed locally
and on `origin`. It is real as of this decision.
**One-time exception, recorded so it is not read as precedent:** the
pre-existing working tree (D6) was committed directly to a newly created `dev`,
not through a feature branch. It was not one feature — it was five unrelated
efforts finished before this flow existed, and routing it through a feature
branch would have been ceremony over already-complete work. Every task from
T-002 onward uses a feature branch.

### D11 — The pre-existing tree lands as topic-focused commits
**Approved:** user (2026-07-26).
**Consequence:** ten atomic commits on `dev` (`86765ba`…`0ab7bd6`) rather than
one mixed commit. This repo's history is deliberately atomic; a single ~800-line
commit spanning the HTMX platform, the graph, the sidebar, the design system and
docs is the one shape that makes a future `git bisect` through this range
useless. Two files needed hunk-level splitting to keep the topics honest —
`main.ts` (dev port vs. the workspace-file regex) and `index.css` (graph hover
rule vs. design tokens vs. the dead sidebar block).
**Authorship:** every commit is `Shivam Khetan <shivkhetan18@gmail.com>`, no
`Co-Authored-By` trailer — this applies to pushes as well (D5).

---

## Proposed

*(nothing may be implemented from this section — the section is currently empty)*
