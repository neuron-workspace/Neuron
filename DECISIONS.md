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

### D17 — Playwright is the end-to-end runner; `@playwright/test` is an approved devDependency
**Approved:** user (2026-07-26, "setup playwright testing for all the features").
**Consequence:** this is the recorded dependency decision D8 requires. It is a
**dev**Dependency — nothing ships to users. Only the Electron app is launched, so
no Playwright browser binaries are downloaded and `npx playwright install` is
deliberately *not* part of setup; if a future test needs a real browser project,
that is a separate decision because it adds hundreds of megabytes to every
clone.
Two rules that exist because breaking them is silent:
1. **Every test runs against a throwaway copy of `examples/demo-repo` with its
   own user-data directory.** The app writes to its workspace as you use it, so
   a suite pointed at the committed demo content rewrites it, and the damage
   surfaces later as unexplained churn in an unrelated commit. This is not
   hypothetical — an empty canvas node appeared in `Idea board.canvas` during
   this very session from the app being open.
2. **`test:e2e` is not part of `npm test`.** It takes minutes and needs a
   desktop session; `npm test` is the fast gate that CI and every contributor
   runs. Whether CI runs the E2E suite at all is open as T-014.

### D18 — When an E2E test fails, verify the test before believing it
**Approved:** Claude (2026-07-26), earned the hard way.
**Consequence:** `AGENTS.md` §3 already says this; the Playwright work turned it
into a measured ratio. Three specs failed while being written and **all three
were the test, not the product**: `.md` opens in reading view so `.cm-content`
does not exist yet; an htmx view stops at a permission prompt before rendering
(the security boundary working correctly); and `app.windows()` also surfaces a
webview's page once it settles, which made one assertion pass alone and fail in
a full run. Each was resolved by reading the source, not by loosening the
assertion. A UI E2E failure is a *question* about the product, not a report
about it.

### D19 — Custom-code containment is a write journal, not a virtual filesystem
**Approved:** user (2026-07-26).
**Consequence:** the premise was checked before designing, and it moved the
target. `.ndash` is already the *most* contained surface in the app — sandboxed
webview, no Node, `connect-src 'self'`, every file operation through capability
check → path policy → atomic write with hash-based conflict detection. The
unsandboxed code paths are the **PTY** (`main.ts:482`: real shell, workspace
cwd, `env: process.env` inherited wholesale) and **plugins** (in-renderer,
full `electronAPI`). What is missing everywhere is not containment but
**reversibility**: `grep` finds no snapshot, journal, or backup anywhere in
`src/main`, and delete is a bare `fs.unlinkSync`. That is risk R4, uncontrolled.

So: a pre-image journal with restore, covering **every** workspace write path —
editor, `.ndash`, plugins, canvas, `.db`. Not a copy-on-write overlay. Data loss
does not care which subsystem caused it, and a per-surface guard would leave the
editor, the most-used writer, unprotected. The overlay's extra value is
diff-before-apply UX, which is not what was asked for and costs a subsystem.

Design decisions a non-interactive implementer cannot make, settled here:

1. **Store location: `<userData>/journal/<sha256(workspaceRoot)>/`.** *Not*
   inside the workspace. A `.neuron/journal/` would sync through OneDrive /
   Dropbox / Git along with the notes, and a cloud-sync conflict on the recovery
   store is the worst available failure mode — losing the thing you restore
   from, at exactly the moment you need it. It would also bloat notes
   repositories that are kept in Git.
2. **Only pre-images of destructive operations** — overwrite and delete of an
   existing file. A create has no pre-image; "undo create" is out of scope.
3. **Trigger points:** `notes:write` and `notes:delete` in `main.ts`, plus
   `apiFileUpdate` and `apiFileDelete` in `htmx/server.ts`. Those are every
   destructive path.
4. **A journal failure must never block the write.** If the store is full or
   unwritable and the write is blocked, the user cannot save while typing —
   availability of their in-progress note beats recoverability of the previous
   version. The failure is logged and surfaced, never swallowed silently.
5. **Retention is capped** by entry count, age, and total bytes, pruned
   oldest-first. Files over the size cap are not copied, and record an explicit
   skip marker — a journal that silently omits an entry is worse than one that
   says it has nothing, because restore would claim success on a file it never
   captured.
6. **No new dependency.** Node `fs` and `crypto` only.

### D20 — The journal is main-process only and is never reachable from the view API
**Approved:** Claude (2026-07-26). This is the trap in D19 and needs its own entry.
**Consequence:** restore and listing are exposed over IPC to the trusted renderer
only. **No route, capability, or fragment may expose journal contents to a
`.nhtml` / `.ndash` / mini-app view.** The journal holds pre-images of files from
across the whole workspace; a view granted `workspace.files.read` on `data/**`
that could read the journal would read historical content of every file outside
its path policy. That is a complete path-policy bypass wearing a recovery
feature's clothes. The store lives outside the workspace root, so
`resolveInWorkspace` already refuses it — this decision exists so nobody
"helpfully" adds a convenience route later.

### D21 — A single delegated job runs in the primary checkout, not a worktree
**Approved:** Claude (2026-07-26), correcting D14's side effect.
**Consequence:** worktrees exist to make *parallel* jobs safe (D13), and they
cost the ability to verify, because they have no `node_modules` (D14). For a
single job that trade is all cost: `AGENTS.md` §3 says a job that cannot verify
has failed, and for a data-integrity subsystem, shipping code the author never
executed is precisely the wrong trade. `AGENTS.md` §8 forbids *two* writing
agents in one checkout; one is fine. So a lone job runs with `--cwd` on the
primary checkout, can run `npm test`, and its diff is reviewed uncommitted per
§9. Worktrees remain mandatory the moment a second concurrent job exists.
**Corollary:** E2E specs (T-012) are therefore *not* worktree material either —
Playwright selectors written without running them are guesses, which is exactly
how three specs failed during T-011.

### D22 — A test may not cause an effect outside the test process
**Approved:** Claude (2026-07-26), after the user found the violation.
**Consequence:** the E2E security spec drove the app frame at external URLs to
prove the navigation guard blocks them. It does — but `main.ts` also hands a
blocked http(s) URL to the OS browser via `shell.openExternal`, so the suite
opened real tabs in the developer's real Chrome. Three per run, seven runs, all
while reporting green.

This is the failure class to watch for: an effect that leaves the test process
cannot be caught by an assertion, cannot be undone by teardown, and does not
make the suite red. The suite was not going to find it — the **user** did.

So: anything in `e2e/` that can reach outside the process is stubbed **in the
fixture, before any test body runs**, never per-test. Per-test opt-in fails
silently when someone forgets. Currently stubbed: `shell.openExternal`. The
same treatment is required before any test touches the network, the clipboard,
notifications, the OS shell, auto-update, or a real workspace path.
**A stub must also be asserted on**, so it is self-verifying: the nav tests
check the recorded call, which means a stub that stops taking effect turns the
test red instead of quietly resuming the side effect.

### D23 — Relicense to Apache 2.0
**Approved:** user (2026-08-23).
**Consequence:** the LICENSE text is the canonical file fetched from
`apache.org/licenses/LICENSE-2.0.txt`, not a reconstruction, with only the
appendix placeholder filled in as the license itself instructs. A `NOTICE` file
now exists because Apache 2.0 expects one for attribution and MIT had no
equivalent.

Three things this does **not** do, recorded so nobody assumes otherwise:

1. It is **prospective only.** Every version already published under MIT stays
   MIT for anyone holding it — a licence cannot be retracted from released code.
2. It does **not** relicense dependencies. The tree underneath Neuron keeps its
   own terms, which is what `NOTICE` says out loud.
3. It is **not legal advice.** The relicense is clean because the rewritten
   history has exactly one author and no CLA ambiguity, which is why the
   `package.json` author moved from the placeholder "Neuron contributors" to the
   actual copyright holder. If outside contributions ever land, that assumption
   stops holding.

### D24 — Version drops to 0.4.2 before the Microsoft Store submission
**Approved:** user (2026-08-23).
**Consequence:** the Store accepts only increasing version numbers once an app
is published, so this move is possible **exactly once, now**. 0.4.2 also
describes the software more honestly than 1.4.1 did: no signing, no recovery UI,
no third-party plugin sandbox.

Two consequences that bite later:

- `electron-updater` compares semver. Anyone already running an installed 1.4.x
  will never be offered 0.4.2 as an update; they are stranded until they
  reinstall. Acceptable only because the existing releases are being deleted.
- The `appx` block still carries `REPLACE.WITH.PartnerCenter.IdentityName`,
  `CN=REPLACE-WITH-PARTNER-CENTER-PUBLISHER-ID`, and
  `REPLACE_WITH_PUBLISHER_DISPLAY_NAME`. These are **submission blockers**
  needing real Partner Center values. Left as placeholders deliberately —
  inventing them yields a package that builds and cannot be submitted, which is
  worse than one that fails loudly.

### D25 — CI runs the end-to-end suite (closes T-014)
**Approved:** user (2026-08-23).
**Consequence:** `npm run test:e2e` runs in CI after the build, invoking the same
command a contributor runs rather than calling Playwright directly — a CI step
that diverges from the documented local command can pass while the local one is
broken. Failure artifacts upload only on failure. Beyond coverage, CI is where
the D22 class of escape is cheapest to catch: a runner has no browser for a
stray `shell.openExternal` to open.

### D26 — Command scopes and the two contested shortcuts (unblocks T-005)
**Approved:** user (2026-08-23), who chose "keep the best-known shortcut for each
thing".

**Scope list**, innermost wins:
`input` → `editor` → `canvas` → `htmx-webview` → `modal` → `global`.
A command declares the outermost scope it is valid in; the dispatcher resolves
from the focused element outward and stops at the first match. `modal` sits near
the inside deliberately: while a dialog is open, almost nothing global should
fire.

**`mod+L` = focus search.** This overturns the roadmap. Plan §7 proposed `mod+L`
for "Open layout actions" on the grounds that the chord was free. *Free is not
the same as available*: every browser, and most apps with a search field, bind
`Ctrl+L` to focus the address or search bar. Users arrive with that reflex
already trained, so spending it on a layout palette costs a reflex to buy a
keystroke nobody would have guessed. Neuron has no focus-search action today —
this creates one.

**`mod+\` = split editor / layout actions.** The best-known binding for the job:
VS Code and Obsidian both use it to split. Note it is the **backslash**;
`mod+` + backtick is already the bottom panel, and they are different keys — a
conflict detector that normalises them together would be wrong.

**Scope caveat:** `mod+L` is registered in `global` scope only. CodeMirror binds
`Ctrl+L` to select-line in some keymaps, and the HTMX webview and browser view
treat it as address-bar focus. Scope resolution is what keeps those from
fighting, and the conflict detector must flag any attempt to rebind `mod+L` into
`editor` scope.

### D27 — Push and release hold (active)
**Set by:** user (2026-08-23). **Lift condition:** the user says so explicitly.
**Consequence:** while this stands, **no `git push` of any branch, no tag, no
release, no Pages deploy.** Local commits and merges to `dev` continue as
normal; they simply do not leave the machine.

This is not a general caution — it is specific. The remote is currently a clean
slate: zero releases, zero tags, zero Actions runs, `main` still at the
pre-session commit. That state was deliberately created before a Microsoft Store
submission, and a stray push regenerates Actions history; a stray tag fires
`release.yml` and publishes installers built from unfinished work. Under D24 the
version can only ever go up after the first Store submission, so anything
published early is permanent.

`origin/dev` exists at `1354298` from an earlier authorised push and is 11
commits behind local `dev`. Leave it there.

---

## Proposed

*(nothing may be implemented from this section — the section is currently empty)*
