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

---

## Proposed

*(nothing may be implemented from this section)*

### P1 — Next milestone: M0 (CI gates) then M1 (command & keyboard architecture)
**Rationale:** `docs/roadmap/production-readiness-plan.md` §11 names M0 as the
exact next task, and risk **R7** ("CI merges regressions") is rated High
likelihood with no control at all — CI currently runs `npm run build` only, so
neither the type checks nor the five test suites gate a merge. M0 is also the
cheapest possible first delegation: it is mechanical, it touches files nothing
else touches, and it makes every later delegation's review cheaper.
**Awaiting:** user approval, and confirmation that M1 (not a UI/graph item) is
the follow-on.

### P2 — Branch model: keep working directly on `main`, or adopt the `feature/* → dev → test → main` flow
**Rationale:** `.agents/BRANCH_RULES.md` describes a `feature/* → dev → test →
main` promotion model, but only `main` has ever existed locally or on
`origin` — the flow was documented and never adopted. This must be settled
before the first delegation, because it determines whether reviewed work lands
on `main` directly or via a branch.
**Consequence either way:** if `main` stays the working branch, `.agents/BRANCH_RULES.md`
is aspirational and should say so, so a future agent does not try to follow it.
If the flow is adopted, every task row gains a branch and the release docs need
updating.
**Awaiting:** user decision.

### P3 — How to commit the existing working tree (see D6)
**Rationale:** the uncommitted work spans several unrelated efforts (HTMX theme
system + app paths, GraphCanvas highlighting, sidebar collapse, `.ndash`
dashboards + `DbView`, docs). It can land as one "work in progress" commit or as
a handful of topic-focused commits matching this repo's existing history style.
**Awaiting:** user decision. Claude's recommendation: topic-focused commits,
because the repo's history is deliberately atomic and a single 800-line
mixed commit is the one thing that makes a future bisect useless.
