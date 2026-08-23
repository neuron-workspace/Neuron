# CLAUDE.md — read this first

Neuron is a local-first Electron + React workspace for Markdown/MDX, Canvas,
typed databases, and sandboxed HTML views. Version **0.4.2**, **Apache 2.0**.

**The repository is the source of truth. Not Claude's memory, not a Codex
thread.** Both are lossy and neither survives a restart. Anything that must
outlive a session goes in a tracked file or a commit message.

---

## Read before you work — in this order, and stop when you have enough

| Step | File | Why |
| --- | --- | --- |
| 1 | `.claude/CURRENT_STATE.md` | What the app is today. 2–3 pages, no code reading required. |
| 2 | `SHARED_TASKS.md` | The **only** task board. Pick work here. |
| 3 | `.claude/ACTIVE_TASK.md` | Who is holding which files right now. Check before editing anything. |
| 4 | `DECISIONS.md` | Numbered, binding. Read the ones your task touches, not all of them. |
| 5 | `.claude/context-packs/<subsystem>.md` | Only the pack for the subsystem you are changing. |
| 6 | `AGENTS.md` | The delegation contract. Read fully before sending work to Codex. |

Steps 1–3 are mandatory. Steps 4–6 are scoped to the task.

## Do NOT re-audit the whole repository

A full-repo scan is the default failure of a fresh agent session: expensive,
slow, and it rediscovers what is already written down. Read the files above
instead.

A full audit is justified **only** when:

- `.claude/CURRENT_STATE.md` contradicts what you observe in the code, **or**
- you are explicitly asked for an audit, **or**
- more than ~20 commits have landed since `CURRENT_STATE.md` was last updated
  (check with `git log --oneline -1 -- .claude/CURRENT_STATE.md`).

If you do audit, **update `CURRENT_STATE.md`** so the next session does not
repeat it. An audit whose findings are not written down is work done twice.

## Picking the next task

1. `SHARED_TASKS.md` is grouped into waves by dependency. Take from the earliest
   wave with a `READY` row.
2. `NEEDS_USER` means a human decision is missing. Do not guess it — ask.
3. Check `.claude/ACTIVE_TASK.md` for a lock on the files you would touch.
4. Claim the row and the lock **before** editing, and commit the claim.

## Before you stop — non-negotiable

Whatever else happened, leave these true:

1. `.claude/HANDOFF.md` has an entry: what changed, what ran, what did not, what
   is next, and what is blocked.
2. `.claude/TEST_STATUS.md` records what you actually ran and its real result.
   **Never** record a result you did not observe.
3. `.claude/ACTIVE_TASK.md` releases any lock you took.
4. `SHARED_TASKS.md` reflects reality — a row is `DONE` only if its acceptance
   criteria were re-run and passed here.

An unfinished task with an honest handoff is recoverable. A finished task with
no handoff costs the next session an hour of rediscovery.

## Standing verification commands

```bash
npm run typecheck    # both tsconfig projects
npm test             # unit suites
npm run build        # clean + main + renderer
npm run test:e2e     # Playwright against the real Electron app
```

Run them **yourself**. Never accept a reported result from another agent.

## Working with Codex

`AGENTS.md` is the full contract. The short version: Claude plans, decomposes,
decides, reviews, and makes every commit; Codex implements work that is already
fully specified. Codex runs non-interactively and cannot ask a question, so any
ambiguity left in a packet becomes a guess.

Plugin capabilities, exact commands, and their limits: `.claude/AGENT_PROTOCOL.md`.
