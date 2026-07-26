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

### D12 — UI and frontend tasks are done with the `impeccable` skill
**Approved:** user (2026-07-26).
**Consequence:** any task that designs, redesigns, critiques, audits, or polishes
a Neuron interface loads `impeccable` first (the pack is also vendored at
`.agents/skills/impeccable/`) rather than being approached ad hoc. Related packs
from ui-skills.com are chosen per task; `impeccable` is the default.
**Scope note, so this is not over-applied:** it governs *interface* work. T-002
(CI config), T-003 (governance Markdown), and T-008 (protocol/transport
architecture) are not UI tasks and do not use it. The first genuine candidates
are the deferred design-system and graph-interaction items in
`docs/roadmap/deferred-work.md`.

### D13 — T-002, T-003 and T-008 run in parallel, one git worktree each
**Approved:** user (2026-07-26).
**Consequence:** this is the `AGENTS.md` §8 gate being exercised deliberately,
not bypassed. The three rows have zero overlap: T-002 owns
`.github/workflows/ci.yml` + `package.json` `scripts`; T-003 owns *new* files
under `.github/` only; T-008 writes one new design document and no code. Each
gets its own branch **and** its own worktree under `../neuron-worktrees/`, one
Codex job per worktree, because two writing agents in one checkout can leave a
half-written file that still compiles. Review and merge are sequential, and the
four standing checks re-run in the primary checkout after each merge.

### D14 — Worktrees deliberately have no `node_modules`; a delegated agent must not create one
**Approved:** Claude (2026-07-26).
**Consequence:** this is the direct collision between `AGENTS.md` §4 ("never
install") and §3 ("a job that cannot verify has FAILED"), and it is resolved in
favour of §4. A worktree cannot run `npm test` or `npm run build`, and an agent
that tries will hit a missing-module error that looks exactly like a broken
workspace and invites the reinstall D4 forbids. So: every packet for a worktree
job states that npm is unavailable there **by design**, that this is not a
defect to report or repair, and that verification is Claude's job in the primary
checkout. Only tasks whose acceptance can be judged structurally (config,
Markdown, a design document) may be delegated this way. Anything needing a real
test run stays in the primary checkout, sequential.

### D15 — T-008 produces a decision record only; no production code
**Approved:** user (2026-07-26, implicit in "before coding, produce a concise
implementation decision record").
**Consequence:** the `neuron://` evaluation ships exactly one artifact —
`docs/architecture/neuron-protocol-api.md` — containing the compatibility
findings with citations, the transport decision (custom-protocol-only /
loopback-only / hybrid), the route table, the session and authorization model,
the files that would change, the tests to add, and a rollback plan. The HTMX
platform is working, tested, and is the repo's strongest security asset; the
standing rule against "speculative rewrites of stable subsystems" means the
rewrite is not authorized by the investigation. Implementation is separate rows,
opened only after the user accepts the record. **If HTMX cannot work correctly
over `neuron://` with standard request semantics, "keep the loopback server" is
a successful outcome of this task, not a failure.**

### D16 — On this account, model routing is effort-only
**Approved:** Claude (2026-07-26), forced by the environment.
**Consequence:** the `AGENTS.md` §7 routing table assumes a small/mid/top-tier
model choice. This Codex install authenticates with a ChatGPT account, and the
small tier is refused:
`400 invalid_request_error — The 'gpt-5.3-codex-spark' model is not supported
when using Codex with a ChatGPT account.` Two jobs (T-002, T-003) failed on this
in ~20s each before being relaunched.
So: **do not pass `--model` unless a specific model is known to work on this
account.** Route by `--effort` instead — `low` for mechanical edits and docs,
`medium` for default implementation, `high` for architecture, security, data
loss, rendering, undo/history, a failed prior attempt, or adversarial review.
The trap: the failure is fast and returns a *job* that reports `failed` rather
than an error at launch, so a job launched with a bad model looks like it
started normally and can sit unnoticed in `running` for the seconds before it
flips.

---

## Proposed

*(nothing may be implemented from this section — the section is currently empty)*
