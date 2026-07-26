# AGENTS.md — rules for every agent working in this repository

Read this file first. Then read `SHARED_TASKS.md`, `DECISIONS.md`, and `HANDOFF.md`.

Neuron is a local-first Electron + React desktop workspace for Markdown/MDX,
Canvas (`.canvas`), typed databases (`.db`), and capability-scoped HTMX views
(`.nhtml` / `.ndash`). Local files are the source of truth. Privileged work
(filesystem, settings, AI, network, PTY) lives in the main process behind a
narrow preload bridge.

---

## 1. Roles

| | Claude Code | Codex (via `codex-plugin-cc`) |
| --- | --- | --- |
| Architecture, decomposition, scope control | ✅ | ❌ |
| Product / UX / trade-off judgment | ✅ | ❌ |
| Implementation of a fully specified task | ✅ | ✅ |
| Review of the other agent's diff | ✅ | ❌ |
| **Commits** | ✅ **only Claude commits** | ❌ never |

**Codex runs non-interactively and cannot ask the user anything.** A question it
cannot answer becomes a guess, and the guess becomes scope drift that only
surfaces in review. Every task requiring human judgment is owned by Claude.
No task is ever owned by "Codex + User".

**If a delegated agent hits a question it cannot answer from the repository and
its delegation packet, it must STOP and report the question.** Reporting a
blocker is a successful outcome, not a failure.

---

## 2. The four documents

| File | Purpose |
| --- | --- |
| `AGENTS.md` | These rules. |
| `SHARED_TASKS.md` | **The single task board.** One row per task. Never a second list. |
| `DECISIONS.md` | Numbered decisions. `Accepted` strictly separated from `Proposed`. |
| `HANDOFF.md` | Append-only, newest first. Codex job + session IDs land here. |

Statuses: `BACKLOG` `NEEDS_USER` `READY` `IN_PROGRESS` `BLOCKED` `REVIEW` `DONE`.
`DONE` only when the acceptance criteria have actually been re-run and passed in
this environment.

`docs/roadmap/*`, `docs/design/*`, and `.agents/*` hold rationale and backlog
**material**, never task status. `.agents/` and `.claude/` are gitignored and are
not visible to a delegated agent — anything Codex needs must be in the packet or
in a tracked file.

---

## 3. Standing verification commands

Run **all four**, yourself, in this environment, every time. Never accept a
reported result from another agent.

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.renderer.json --noEmit
npm test
npm run build
```

`npm test` currently runs five suites: `view-security`, `frontmatter`,
`htmx-views`, `canvas-model`, `sanitize-html`.

**Rebuild before any check that consumes a build artifact.** `npm run build`
runs `clean:build` first, so it is self-cleaning; anything reading `dist/`
without rebuilding reports the *previous* run's result and hands you a
confident false pass.

**When a test fails, verify the test before believing the failure.** A stale
selector or an over-precise assertion looks exactly like a product defect.

UI work additionally needs the app running (`npm run dev`, port **5174**).
A headless suite is defect evidence only — it is not proof the pixels are right.
Anything marked "needs app" in `docs/roadmap/deferred-work.md` cannot be closed
by a delegated agent.

---

## 4. Environment rules for the delegated agent

The delegated sandbox may lack tools on `PATH` or hit permission errors.
**That is a sandbox limitation, not a broken workspace.**

- **Never install, repair, upgrade, or rebuild dependencies.** No `npm install`,
  no `npm ci`, no `electron-rebuild`, no `node-gyp`, no lockfile edits, no
  `node_modules` changes. `node-pty` and `sql.js` depend on prebuilt binaries
  that a rebuild attempt has already broken once in this repo's history.
- A missing tool is **reported**, never diagnosed.
- **A job that cannot verify has FAILED.** It must not repair its way to a green
  run.

---

## 5. Before delegating (Claude's checklist)

1. Read all four documents.
2. Claim the task row (owner, `IN_PROGRESS`, touch scope) and commit that claim.
3. Resolve every ambiguity **now** and write it into `DECISIONS.md` with its
   consequence. Name the specific trap the implementer would otherwise fall into.
4. Run `/codex:status`. Never start a job while a related one is running.

## 6. Delegation packet (all fields, every time)

Task ID · Objective (the OUTCOME, not the steps) · Session to resume · Model and
effort · Authorization · Allowed files · Forbidden files · Dependencies and
assumptions · Acceptance criteria · Required unit tests · Required end-to-end
scenario · Commands Claude will independently rerun · Explicit prohibitions ·
Stopping condition.

Always include verbatim:

> If you hit a question you cannot answer from the repository and this packet,
> stop and report it rather than choosing.

**Prohibitions in every packet:** no dependency / lockfile / `node_modules`
changes; nothing outside the allowed files; no weakening or deleting existing
assertions; no destructive filesystem or git operations; **NO COMMIT** — leave
the work uncommitted for review.

---

## 7. Continuity and model routing

Prefer `/codex:rescue --resume` for follow-ups, corrections, and same-subsystem
work; name the task ID in the prompt. Use `--fresh` only for genuinely
independent work or when the previous session is unusable. **A finished job is
still resumable — completion is not a reason for `--fresh`.** Resume does not
survive a plugin runtime restart, which is why decisions live in `DECISIONS.md`
and not in session memory.

Route by risk, not by defaulting to the largest model:

| Work | Model / effort |
| --- | --- |
| Default implementation | mid-tier, high effort |
| Data-loss, corruption, architecture, rendering, undo/history, security | top-tier, high effort |
| Also top-tier: a failed prior attempt, or adversarial review | top-tier, high effort |
| Mechanical edits, docs, scaffolding | small, medium effort |

Omit `--model` / `--effort` when resuming; a resumed task keeps its own.

---

## 8. Parallel work

**Never two writing agents in one checkout.** After every delegation, check
`/codex:status` for more than one active job and cancel duplicates before
reviewing — a forwarder can launch twice, and two agents editing one file can
leave a half-written result that still compiles.

Parallel implementation requires **all** of: both rows marked parallel-safe; no
dependency between them; zero overlap in production *and* test files; no shared
schemas/config/deps; a separate branch **and** git worktree each; one Codex job
per worktree; sequential review and merge; full suite re-run after merging; and
the user's approval before any worktree is created.

Keep sequential when tasks touch the same component or store, shared schemas,
persistence formats, IPC, undo/redo, dependencies, or the decision documents.
In this repo that specifically means `src/renderer/App.tsx`, `src/main/main.ts`,
`src/renderer/index.css`, `src/main/htmx/*`, and `package.json` are effectively
serialization points.

---

## 9. Review and commit (Claude)

1. Retrieve the result; inspect `git status` and the **complete** diff.
2. Confirm nothing unrelated, generated, or out-of-scope crept in.
3. Review against the recorded decisions.
4. Run every standing check independently.
5. For corrections, send **one** bounded follow-up via `--resume` naming the task
   ID, and state explicitly which parts to **KEEP** — good work gets reverted
   during fixes otherwise.
6. On acceptance: mark `DONE` with measured evidence, append to `HANDOFF.md`,
   make **one** intentional commit, report the SHA.
7. Ask the user before claiming the next task.

**Commit messages** record what was wrong and why the fix is shaped that way,
not just what changed. Note anything corrected in the delegated work and
anything deliberately kept.

**Authorship:** every commit is authored by Shivam Khetan
<shivkhetan18@gmail.com>. **No `Co-Authored-By` trailer, ever** — not for
Claude, not for Codex.

---

## 10. Repository non-goals

Arbitrary code execution; a generic filesystem proxy; raw `ipcRenderer` in the
renderer; unsafe template evaluation; unrestricted third-party plugins with Node
access; deleting user data or config without migration + backup; a block-editor
JSON model replacing Markdown on disk; new runtime dependencies without a
recorded decision; speculative rewrites of stable subsystems (canvas model,
HTMX server, frontmatter).
